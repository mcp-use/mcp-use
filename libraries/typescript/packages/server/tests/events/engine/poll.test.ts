import { EventsError } from "@mcp-use/events-core";
import { describe, expect, it } from "vitest";
import { LeaseToucher } from "../../../src/events/engine/leases.js";
import {
  handlePoll,
  nextPollMs,
  type PollDeps,
} from "../../../src/events/engine/poll.js";
import { createRateLimiter } from "../../../src/events/engine/quotas.js";
import type { DirectLease, LogValue } from "../../../src/events/internal/records.js";
import { codec, event, memoryLog, registry } from "./fixtures.js";

const ev = (data: unknown, at = 1000, extra: Partial<Extract<LogValue, { k: "e" }>> = {}): LogValue => ({
  v: 1,
  k: "e",
  id: `id_${JSON.stringify(data)}`,
  ts: "2026-11-25T10:00:00.000Z",
  at,
  data,
  partition: null,
  ...extra,
});

function setup(over: Partial<PollDeps> = {}, evOver: Parameters<typeof event>[1] = {}) {
  const log = memoryLog();
  let now = 10_000;
  const deps: PollDeps = {
    registry: registry(event("note.created", evOver)),
    backend: log,
    codec,
    env: { webhookPrincipalSource: true, pollEnabled: true, pushEnabled: true },
    era: "modern",
    listedModes: "servable",
    now: () => now,
    pollIntervalMs: 10_000,
    isDormant: () => false,
    isVisible: async () => true,
    validateArgs: async (_e, a) => a,
    principal: () => "iss|alice",
    authorize: async () => true,
    isClosed: async () => false,
    rate: createRateLimiter(120),
    onSubscribe: async () => {},
    ...over,
  };
  return { log, deps, setNow: (n: number) => (now = n) };
}

describe("events/poll (D51)", () => {
  it("answers a null cursor with the head and no events", async () => {
    const { log, deps } = setup();
    log.append("note.created", ev({ folder: "inbox" }));
    expect(await handlePoll({ name: "note.created", cursor: null }, deps)).toEqual({
      events: [],
      cursor: "c.e1.1",
      truncated: false,
      hasMore: false,
      nextPollMs: 10_000,
    });
  });

  it("returns matching events after the cursor without a per-event cursor", async () => {
    const { log, deps } = setup();
    log.append("note.created", ev({ folder: "inbox", n: 1 }));
    log.append("note.created", ev({ folder: "other", n: 2 }));
    log.append("note.created", ev({ folder: "inbox", n: 3 }));
    const r = await handlePoll(
      { name: "note.created", arguments: { folder: "inbox" }, cursor: "c.e1.0" },
      deps
    );
    expect(r.events).toEqual([
      { eventId: 'id_{"folder":"inbox","n":1}', name: "note.created", timestamp: "2026-11-25T10:00:00.000Z", data: { folder: "inbox", n: 1 } },
      { eventId: 'id_{"folder":"inbox","n":3}', name: "note.created", timestamp: "2026-11-25T10:00:00.000Z", data: { folder: "inbox", n: 3 } },
    ]);
    expect(r.cursor).toBe("c.e1.3");
    expect(r.hasMore).toBe(false);
  });

  it("stops at maxEvents with hasMore true", async () => {
    const { log, deps } = setup();
    for (let i = 0; i < 5; i++) log.append("note.created", ev({ i }));
    const r = await handlePoll({ name: "note.created", cursor: "c.e1.0", maxEvents: 2 }, deps);
    expect(r.events.length).toBe(2);
    expect(r.cursor).toBe("c.e1.2");
    expect(r.hasMore).toBe(true);
  });

  it("reports truncation when the log was trimmed past the cursor", async () => {
    const { log, deps } = setup();
    for (let i = 0; i < 5; i++) log.append("note.created", ev({ i }));
    log.trim("note.created", 4);
    const r = await handlePoll({ name: "note.created", cursor: "c.e1.1" }, deps);
    expect(r).toMatchObject({ events: [], cursor: "c.e1.3", truncated: true, hasMore: true });
  });

  it("skips entries older than the maxAgeMs floor and flags truncated", async () => {
    const { log, deps } = setup();
    log.append("note.created", ev({ i: 1 }, 1000));
    log.append("note.created", ev({ i: 2 }, 9500));
    const r = await handlePoll({ name: "note.created", cursor: "c.e1.0", maxAgeMs: 1000 }, deps);
    expect(r.events.map((e) => e.data)).toEqual([{ i: 2 }]);
    expect(r.truncated).toBe(true);
  });

  it("answers a targeting control entry's error without advancing", async () => {
    const { log, deps } = setup();
    log.append("note.created", {
      v: 1,
      k: "t",
      at: 1,
      to: { principals: ["iss|alice"] },
      error: { kind: "forbidden", message: "Forbidden", data: { reason: "revoked" } },
    });
    await expect(handlePoll({ name: "note.created", cursor: "c.e1.0" }, deps)).rejects.toMatchObject({
      kind: "forbidden",
      data: { reason: "revoked" },
    });
  });

  it("never returns entries targeted at another principal or a webhook subscription", async () => {
    const { log, deps } = setup();
    log.append("note.created", ev({ i: 1 }, 1000, { to: { principals: ["iss|bob"] } }));
    log.append("note.created", ev({ i: 2 }, 1000, { to: { subscriptionId: "sub_x" } }));
    const r = await handlePoll({ name: "note.created", cursor: "c.e1.0" }, deps);
    expect(r.events).toEqual([]);
    expect(r.cursor).toBe("c.e1.2");
  });

  it("follows the validation order", async () => {
    await expect(handlePoll({ name: "x" }, setup({ era: "legacy" }).deps)).rejects.toMatchObject({ code: -32601 });
    await expect(handlePoll({ name: "nope" }, setup().deps)).rejects.toMatchObject({ kind: "notFound", data: { kind: "event" } });
    await expect(handlePoll({ name: "note.created" }, setup({}, { replay: false }).deps)).rejects.toMatchObject({
      kind: "unsupported",
      data: { feature: "deliveryMode", value: "poll" },
    });
    await expect(handlePoll({ name: "note.created", maxEvents: 1.5 }, setup().deps)).rejects.toMatchObject({
      kind: "invalidParams",
      data: { field: "maxEvents" },
    });
    await expect(handlePoll({ name: "note.created" }, setup({ principal: () => null }).deps)).rejects.toMatchObject({
      data: { reason: "principal_required" },
    });
    await expect(handlePoll({ name: "note.created" }, setup({ authorize: async () => false }).deps)).rejects.toMatchObject({
      data: { reason: "not_authorized" },
    });
  });

  it("limits polls to 120 per minute per principal and name", async () => {
    const { deps } = setup();
    for (let i = 0; i < 120; i++) await handlePoll({ name: "note.created" }, deps);
    const err = await handlePoll({ name: "note.created" }, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventsError);
    expect((err as EventsError).data).toEqual({ limit: "pollRate", retryAfterMs: 60_000 });
  });

  it("keys anonymous poll rates by client address", async () => {
    const a = setup({ principal: () => "anonymous", clientAddress: "1.1.1.1", rate: createRateLimiter(1) });
    await handlePoll({ name: "note.created" }, a.deps);
    await handlePoll({ name: "note.created" }, { ...a.deps, clientAddress: "2.2.2.2" });
    await expect(handlePoll({ name: "note.created" }, a.deps)).rejects.toMatchObject({ data: { limit: "pollRate" } });
  });

  it("caps nextPollMs at one second minimum and uses pollInterval", () => {
    expect(nextPollMs(event("a", { definition: { pollInterval: 200 } }), 10_000)).toBe(1000);
    expect(nextPollMs(event("a", { definition: { pollInterval: "30s" } }), 10_000)).toBe(30_000);
  });
});

describe("direct leases (D58)", () => {
  function leaseBackend() {
    const leases = new Map<string, DirectLease>();
    const writes: string[] = [];
    return {
      leases,
      writes,
      async touchLease(i: { id: string; name: string; principal: string; args: Record<string, unknown>; mode: "poll" | "push"; ttlMs: number }) {
        writes.push(i.id);
        const existing = leases.get(i.id);
        const lease: DirectLease = {
          v: 1, id: i.id, name: i.name, principal: i.principal, args: i.args,
          modes: [i.mode], createdAt: 0, touchedAt: 0, expiresAt: 10_000 + i.ttlMs,
        };
        leases.set(i.id, lease);
        return { created: !existing, lease };
      },
    };
  }

  it("runs onSubscribe once on first touch and writes at most every ttl/2", async () => {
    const b = leaseBackend();
    const calls: string[] = [];
    const { deps, setNow } = setup(
      { leases: new LeaseToucher(b, async (id) => void b.leases.delete(id)), onSubscribe: async (_e, info) => void calls.push(info.mode) },
      { hooks: { onSubscribe: true, onUnsubscribe: true } }
    );
    await handlePoll({ name: "note.created" }, deps);
    setNow(10_000 + 60_000);
    await handlePoll({ name: "note.created" }, deps);
    setNow(10_000 + 151_000);
    await handlePoll({ name: "note.created" }, deps);
    expect(calls).toEqual(["poll"]);
    expect(b.writes.length).toBe(2);
  });

  it("rolls the lease back when onSubscribe throws", async () => {
    const b = leaseBackend();
    const { deps } = setup(
      {
        leases: new LeaseToucher(b, async (id) => void b.leases.delete(id)),
        onSubscribe: async () => {
          throw new EventsError("forbidden", "", { reason: "not_authorized" });
        },
      },
      { hooks: { onSubscribe: true, onUnsubscribe: false } }
    );
    await expect(handlePoll({ name: "note.created" }, deps)).rejects.toMatchObject({ kind: "forbidden" });
    expect(b.leases.size).toBe(0);
  });
});
