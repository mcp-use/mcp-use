import { describe, expect, it } from "vitest";
import { dispatchName } from "../../../src/events/engine/dispatcher.js";
import { processDue } from "../../../src/events/engine/process.js";
import { enqueueReplay } from "../../../src/events/engine/replay.js";
import { watermarkCursor } from "../../../src/events/engine/watermark.js";
import {
  appendEvent,
  fakeEvent,
  harness,
  OPENAI_AXES,
  putSubscription,
  registryOf,
  status,
} from "./engine-harness.js";

describe("dispatcher", () => {
  it("fans out to matching subscriptions only, honouring match and targeting (W-1)", async () => {
    const h = harness(
      registryOf(
        fakeEvent("n", {
          match: async (args, data) =>
            (args as { tag?: string }).tag === (data as { tag: string }).tag,
        })
      )
    );
    await putSubscription(h, { id: "sub_A", name: "n", args: { tag: "a" } });
    await putSubscription(h, { id: "sub_B", name: "n", args: { tag: "b" } });
    await putSubscription(h, {
      id: "sub_C",
      name: "n",
      args: { tag: "a" },
      principal: "bob",
    });
    await appendEvent(
      h,
      "n",
      "e1",
      { tag: "a" },
      { to: { principals: ["alice"] } }
    );
    const r = await dispatchName(h.ctx, "n");
    expect(r).toEqual({
      ran: true,
      matched: 1,
      jobs: 1,
      through: 1,
      more: false,
    });
    expect(await h.ctx.storage.indexCount(h.ctx.keys.inflight("sub_A"))).toBe(
      1
    );
    expect(await h.ctx.storage.indexCount(h.ctx.keys.inflight("sub_B"))).toBe(
      0
    );
    expect(await h.ctx.storage.indexCount(h.ctx.keys.inflight("sub_C"))).toBe(
      0
    );
  });

  it("openai profile: webhook-id is the normalized eventId and cursor is null (K-O webhookId)", async () => {
    const h = harness(registryOf(fakeEvent("n")));
    await putSubscription(h, {
      id: "sub_A",
      name: "n",
      profile: {
        preset: "openai",
        revision: 1,
        axes: OPENAI_AXES,
        via: "test",
      },
    });
    await appendEvent(h, "n", "note_1", {});
    await processDue(h.ctx);
    expect(h.sender.calls[0]!.headers["webhook-id"]).toBe("note_1");
    expect(JSON.parse(h.sender.calls[0]!.body).cursor).toBeNull();
  });

  it("body cursor is the watermark while an earlier event is unacked (W-3, D25)", async () => {
    const h = harness(registryOf(fakeEvent("n")));
    await putSubscription(h, { id: "sub_A", name: "n" });
    h.sender.script.push(status(500));
    await appendEvent(h, "n", "e1", {});
    await processDue(h.ctx);
    await appendEvent(h, "n", "e2", {});
    await dispatchName(h.ctx, "n");
    const members = await h.ctx.storage.indexRange(
      h.ctx.keys.inflight("sub_A"),
      { limit: 5 }
    );
    const job2 = await h.ctx.storage.read(
      h.ctx.keys.job(members.items[1]!.member)
    );
    const body2 = JSON.parse(JSON.parse(job2!.value).body);
    expect(body2.cursor).toBe("c1.ep1.0");
    expect(
      await watermarkCursor(h.ctx, {
        id: "sub_A",
        name: "n",
        start: { epoch: "ep1", seq: 0 },
      })
    ).toBe("c1.ep1.0");
  });

  it("watermark advances to the pointer once everything settled (W-7)", async () => {
    const h = harness(registryOf(fakeEvent("n")));
    await putSubscription(h, { id: "sub_A", name: "n" });
    await appendEvent(h, "n", "e1", {});
    await appendEvent(h, "n", "e2", {});
    await processDue(h.ctx);
    expect(
      await watermarkCursor(h.ctx, {
        id: "sub_A",
        name: "n",
        start: { epoch: "ep1", seq: 0 },
      })
    ).toBe("c1.ep1.2");
  });

  it("drops jobs at or before the subscription start", async () => {
    const h = harness(registryOf(fakeEvent("n")));
    await appendEvent(h, "n", "e1", {});
    await putSubscription(h, {
      id: "sub_A",
      name: "n",
      start: { epoch: "ep1", seq: 1 },
    });
    await processDue(h.ctx);
    expect(h.sender.calls).toHaveLength(0);
  });

  it("pending overflow creates no job and logs pending_overflow (D-11)", async () => {
    const h = harness(registryOf(fakeEvent("n")), {
      maxPendingPerSubscription: 1,
    });
    await putSubscription(h, { id: "sub_A", name: "n" });
    await appendEvent(h, "n", "e1", {});
    await appendEvent(h, "n", "e2", {});
    await dispatchName(h.ctx, "n");
    expect(h.logs.filter((l) => l.type === "pending_overflow")).toHaveLength(1);
  });

  it("oversize bodies create no job and set gapPending", async () => {
    const h = harness(registryOf(fakeEvent("n")), { maxEnvelopeBytes: 50 });
    await putSubscription(h, { id: "sub_A", name: "n" });
    await appendEvent(h, "n", "e1", { big: "x".repeat(100) });
    await dispatchName(h.ctx, "n");
    expect(h.logs.some((l) => l.type === "oversize")).toBe(true);
    expect(await h.ctx.storage.indexCount(h.ctx.keys.inflight("sub_A"))).toBe(
      0
    );
  });
});

describe("replay", () => {
  it("replays (start, head] in seq order, then removes its marker (W-4)", async () => {
    const h = harness(registryOf(fakeEvent("n")));
    for (const id of ["e1", "e2", "e3"]) await appendEvent(h, "n", id, {});
    await processDue(h.ctx, { kinds: ["fanout"] });
    await putSubscription(h, {
      id: "sub_A",
      name: "n",
      start: { epoch: "ep1", seq: 1 },
    });
    await enqueueReplay(h.ctx, "sub_A", "ep1", 1, 3);
    await processDue(h.ctx);
    expect(
      h.sender.calls.map((c) => JSON.parse(c.body).eventId).sort()
    ).toEqual(["e2", "e3"]);
    expect(await h.ctx.storage.indexCount(h.ctx.keys.inflight("sub_A"))).toBe(
      0
    );
  });

  it("paces replay to the unsettled limit (W-10)", async () => {
    const h = harness(registryOf(fakeEvent("n")), { replayPacingUnsettled: 2 });
    for (let i = 1; i <= 5; i++) await appendEvent(h, "n", `e${i}`, {});
    await processDue(h.ctx, { kinds: ["fanout"] });
    await putSubscription(h, {
      id: "sub_A",
      name: "n",
      start: { epoch: "ep1", seq: 0 },
    });
    await enqueueReplay(h.ctx, "sub_A", "ep1", 0, 5);
    await processDue(h.ctx, { kinds: ["replay"] });
    // marker + 2 deliveries
    expect(await h.ctx.storage.indexCount(h.ctx.keys.inflight("sub_A"))).toBe(
      3
    );
    for (let i = 0; i < 5; i++) {
      await processDue(h.ctx);
      await h.clock.advance(1000);
    }
    expect(
      h.sender.calls.map((c) => JSON.parse(c.body).eventId).sort()
    ).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });
});
