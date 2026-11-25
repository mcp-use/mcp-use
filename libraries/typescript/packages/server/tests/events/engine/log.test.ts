import { describe, expect, it } from "vitest";
import {
  controlApplies,
  controlEntry,
} from "../../../src/events/engine/control.js";
import {
  decodeCursor,
  encodeCursor,
  resolveCursor,
} from "../../../src/events/engine/cursor.js";
import {
  appendEvent,
  buildEventEntry,
  generateEventId,
} from "../../../src/events/engine/emit.js";
import { createEventLog } from "../../../src/events/engine/log.js";
import {
  computeTrimBefore,
  hardCap,
} from "../../../src/events/engine/retention.js";
import { EventsConfigError } from "../../../src/events/errors.js";
import { createManualClock } from "../../../src/events/internal/clock.js";
import { createEventsKeyring } from "../../../src/events/store/keyring.js";
import { createEventsKeys } from "../../../src/events/store/keys.js";
import { createSealer } from "../../../src/events/store/seal.js";
import { ReferenceDatabase } from "../../storage/reference-storage.js";

const KEY = new Uint8Array(32).fill(7);
const bounds = { epoch: "abcdefghijkl", first: 5, head: 10 };

describe("cursor codec", () => {
  it("round-trips and matches the c1 format", async () => {
    const c = await encodeCursor(KEY, "ev", "abcdefghijkl", 42);
    expect(c).toMatch(/^c1\.abcdefghijkl\.16\.[A-Za-z0-9_-]{16}$/);
    expect(await decodeCursor(KEY, "ev", c)).toEqual({
      epoch: "abcdefghijkl",
      seq: 42,
    });
    expect(await decodeCursor(KEY, "other", c)).toBeUndefined();
    expect(await decodeCursor(new Uint8Array(32), "ev", c)).toBeUndefined();
  });
});

describe("cursor resolution", () => {
  const at = async (seq: number, epoch = "abcdefghijkl") =>
    encodeCursor(KEY, "ev", epoch, seq);
  const base = { cursorKey: KEY, name: "ev", bounds, replayable: true, now: 0 };

  it("null → head, not truncated", async () => {
    expect(await resolveCursor({ ...base, cursor: null })).toEqual({
      epoch: "abcdefghijkl",
      seq: 10,
      truncated: false,
    });
  });
  it("in retention → seq", async () => {
    expect(await resolveCursor({ ...base, cursor: await at(4) })).toEqual({
      epoch: "abcdefghijkl",
      seq: 4,
      truncated: false,
    });
  });
  it("stale → first − 1, truncated", async () => {
    expect(await resolveCursor({ ...base, cursor: await at(2) })).toEqual({
      epoch: "abcdefghijkl",
      seq: 4,
      truncated: true,
    });
  });
  it("other epoch → first − 1, truncated", async () => {
    expect(
      await resolveCursor({ ...base, cursor: await at(8, "zzzzzzzzzzzz") })
    ).toEqual({ epoch: "abcdefghijkl", seq: 4, truncated: true });
  });
  it("beyond head → head, truncated", async () => {
    expect(await resolveCursor({ ...base, cursor: await at(99) })).toEqual({
      epoch: "abcdefghijkl",
      seq: 10,
      truncated: true,
    });
  });
  it("unverifiable → head, truncated, no error", async () => {
    expect(await resolveCursor({ ...base, cursor: "garbage" })).toEqual({
      epoch: "abcdefghijkl",
      seq: 10,
      truncated: true,
    });
  });
  it("non-replayable ignores the cursor", async () => {
    expect(
      await resolveCursor({ ...base, replayable: false, cursor: await at(4) })
    ).toEqual({ epoch: "abcdefghijkl", seq: 10, truncated: false });
  });
  it("maxAgeMs floor moves the start to the first entry at or after the floor", async () => {
    const entries = [6, 7, 8, 9, 10].map((seq) => ({ seq, at: seq * 100 }));
    const r = await resolveCursor({
      ...base,
      cursor: await at(5),
      now: 1000,
      maxAgeMs: 200,
      scan: async (after, limit) =>
        entries.filter((e) => e.seq > after).slice(0, limit),
    });
    expect(r).toEqual({ epoch: "abcdefghijkl", seq: 7, truncated: true });
  });
});

describe("emit and the log", () => {
  async function setup() {
    const db = new ReferenceDatabase();
    const storage = db.store();
    const keys = await createEventsKeys({ namespace: "n" });
    const log = createEventLog({
      storage,
      keys,
      sealer: createSealer(await createEventsKeyring("s")),
    });
    const clock = createManualClock(1_700_000_000_000);
    return { storage, keys, log, clock };
  }

  it("appends sealed entries, dedupes per target, and marks fan-out", async () => {
    const { storage, keys, log, clock } = await setup();
    const d = { log, keys, clock };
    const o = { maxEvents: 10_000, webhook: true, notify: false };
    const e1 = buildEventEntry(
      {
        name: "ev",
        data: { a: 1 },
        eventId: "u1",
        partition: null,
        principal: "alice",
      },
      clock
    );
    const r1 = await appendEvent(d, "ev", e1, o);
    expect(r1.duplicate).toBe(false);
    expect(r1.seq).toBe(1);
    const again = await appendEvent(d, "ev", e1, o);
    expect(again.duplicate).toBe(true);
    const bob = buildEventEntry(
      {
        name: "ev",
        data: { a: 1 },
        eventId: "u1",
        partition: null,
        principal: "bob",
      },
      clock
    );
    expect((await appendEvent(d, "ev", bob, o)).seq).toBe(2);

    const raw = await storage.logRange(keys.log("ev"), {
      after: null,
      limit: 10,
    });
    expect(raw.entries.map((e) => e.value.includes("alice"))).toEqual([
      false,
      false,
    ]);
    const page = await log.range("ev", null, 10);
    expect(page.entries.map((e) => e.value.k === "e" && e.value.to)).toEqual([
      { principals: ["alice"] },
      { principals: ["bob"] },
    ]);
    const due = await storage.indexRange(keys.fanoutDue(), { limit: 10 });
    expect(due.items.map((i) => i.member)).toEqual(["ev"]);
  });

  it("rejects a payload whose largest body exceeds 256 KiB", async () => {
    const { clock } = await setup();
    let err: unknown;
    try {
      buildEventEntry(
        { name: "ev", data: "x".repeat(262_144), partition: null },
        clock
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EventsConfigError);
    expect((err as EventsConfigError).code).toBe("EVENT_PAYLOAD_TOO_LARGE");
  });

  it("generates evt_ and test_ ids", () => {
    const clock = createManualClock(1);
    expect(generateEventId(clock)).toMatch(/^evt_[0-9A-Z]{26}$/);
    expect(generateEventId(clock, true)).toMatch(/^test_[0-9A-Z]{26}$/);
  });
});

describe("retention", () => {
  it("trims only dispatched entries past age or count", () => {
    const entries = [1, 2, 3, 4].map((seq) => ({ seq, at: seq * 1000 }));
    const replay = { maxAgeMs: 2500, maxEvents: 100 };
    expect(
      computeTrimBefore({
        entries,
        head: 4,
        replay,
        dispatchedThrough: 4,
        now: 5000,
      })
    ).toBe(3);
    expect(
      computeTrimBefore({
        entries,
        head: 4,
        replay,
        dispatchedThrough: 1,
        now: 5000,
      })
    ).toBe(2);
    expect(
      computeTrimBefore({
        entries,
        head: 4,
        replay: { maxAgeMs: 1e9, maxEvents: 1 },
        dispatchedThrough: null,
        now: 5000,
      })
    ).toBe(4);
    expect(
      computeTrimBefore({
        entries,
        head: 4,
        replay: false,
        dispatchedThrough: 4,
        now: 4000 + 120_000,
      })
    ).toBe(4);
    expect(hardCap({ maxAgeMs: 1, maxEvents: 50_000 })).toBe(50_000);
    expect(hardCap(false)).toBe(10_000);
  });
});

describe("control entries", () => {
  it("target principals, subscriptions or all", () => {
    const e = controlEntry(
      { principals: ["a"] },
      { kind: "forbidden", message: "revoked" },
      5
    );
    expect(e).toEqual({
      v: 1,
      k: "t",
      at: 5,
      to: { principals: ["a"] },
      error: { kind: "forbidden", message: "revoked" },
    });
    expect(controlApplies(e, { principal: "a" })).toBe(true);
    expect(controlApplies(e, { principal: "b" })).toBe(false);
    expect(
      controlApplies(
        controlEntry({ all: true }, { kind: "forbidden", message: "" }, 1),
        { principal: "b" }
      )
    ).toBe(true);
  });
});
