import { describe, expect, it } from "vitest";
import { processDue, processJob } from "../../../src/events/engine/process.js";
import { readAttempts } from "../../../src/events/engine/attempt.js";
import {
  listDeadLetters,
  redeliverDeadLetter,
} from "../../../src/events/engine/deadletters.js";
import { readStatus } from "../../../src/events/engine/suspension.js";
import { readFanoutState } from "../../../src/events/engine/watermark.js";
import {
  appendEvent,
  fakeEvent,
  harness,
  putSubscription,
  registryOf,
  status,
  type Harness,
} from "./engine-harness.js";

async function setup(config = {}) {
  const h = harness(registryOf(fakeEvent("note.created")), config);
  const sub = await putSubscription(h, { id: "sub_A", name: "note.created" });
  return { h, sub };
}

async function emitAndDispatch(h: Harness, id: string) {
  await appendEvent(h, "note.created", id, { n: id });
  return processDue(h.ctx, { kinds: ["fanout"] });
}

async function inflightMembers(h: Harness, sub = "sub_A") {
  const r = await h.ctx.storage.indexRange(h.ctx.keys.inflight(sub), {
    limit: 100,
  });
  return r.items.map((i) => i.member);
}

describe("job runtime", () => {
  it("delivers a deliver job and settles it (ack)", async () => {
    const { h } = await setup();
    await emitAndDispatch(h, "e1");
    const report = await processDue(h.ctx);
    expect(report.attempted).toBe(1);
    expect(h.sender.calls).toHaveLength(1);
    const call = h.sender.calls[0]!;
    expect(JSON.parse(call.body)).toEqual({
      eventId: "e1",
      name: "note.created",
      timestamp: "2026-11-24T10:00:00.000Z",
      data: { n: "e1" },
      cursor: "c1.ep1.1",
    });
    expect(call.headers["webhook-id"]).toMatch(/^msg_[A-Za-z0-9_-]{22}$/);
    expect(call.headers["webhook-signature"]).toMatch(/^v1,/);
    expect(call.headers["x-mcp-subscription-id"]).toBe("sub_A");
    expect(await inflightMembers(h)).toEqual([]);
    expect(report.nextWakeAt).toBeNull();
    expect((await readAttempts(h.ctx, "sub_A")).map((a) => a.outcome)).toEqual([
      "ack",
    ]);
  });

  it("retries on the D20 schedule with identical body and webhook-id, then dead-letters exhausted (D-4)", async () => {
    const { h } = await setup();
    await emitAndDispatch(h, "e1");
    for (let i = 0; i < 5; i++) h.sender.script.push(status(500));
    const delays = [30_000, 120_000, 300_000, 420_000];
    await processDue(h.ctx);
    for (const d of delays) {
      await h.clock.advance(d);
      await processDue(h.ctx);
    }
    expect(h.sender.calls).toHaveLength(5);
    expect(new Set(h.sender.calls.map((c) => c.body)).size).toBe(1);
    expect(
      new Set(h.sender.calls.map((c) => c.headers["webhook-id"])).size
    ).toBe(1);
    const dead = await listDeadLetters(h.ctx, { limit: 10 });
    expect(dead.items.map((d) => d.reason)).toEqual(["exhausted"]);
    expect((await readStatus(h.ctx, "sub_A")).status.gapPending).toBe(true);
    expect(await inflightMembers(h)).toEqual([]);
  });

  it("honours Retry-After clamped to twice the scheduled delay (D-5)", async () => {
    const { h } = await setup();
    await emitAndDispatch(h, "e1");
    h.sender.script.push(status(429, { "retry-after": "3600" }));
    await processDue(h.ctx);
    const attempts = await readAttempts(h.ctx, "sub_A");
    expect(attempts[0]!.nextAt! - attempts[0]!.at).toBe(60_000);
  });

  it("410 dead-letters without a gap; 413 queues a gap at once (D-6)", async () => {
    const { h } = await setup();
    await emitAndDispatch(h, "e1");
    h.sender.script.push(status(410));
    await processDue(h.ctx);
    expect((await readStatus(h.ctx, "sub_A")).status.gapPending).toBe(false);
    expect(
      (await listDeadLetters(h.ctx, { limit: 10 })).items.map((d) => d.reason)
    ).toEqual(["http_410"]);

    await emitAndDispatch(h, "e2");
    h.sender.script.push(status(413));
    await processDue(h.ctx);
    // the gap control job went out in the same pass
    const gap = h.sender.calls.at(-1)!;
    expect(JSON.parse(gap.body)).toEqual({ type: "gap", cursor: "c1.ep1.2" });
    expect(gap.headers["webhook-id"]).toMatch(/^msg_gap_/);
  });

  it("the 2xx after an exhausted delivery sends a gap with the watermark", async () => {
    const { h } = await setup({ retryDelaysMs: [0] });
    await emitAndDispatch(h, "e1");
    h.sender.script.push(status(500));
    await processDue(h.ctx);
    expect((await readStatus(h.ctx, "sub_A")).status.gapPending).toBe(true);
    await emitAndDispatch(h, "e2");
    await processDue(h.ctx);
    const bodies = h.sender.calls.map((c) => JSON.parse(c.body));
    expect(bodies.at(-1)).toEqual({ type: "gap", cursor: "c1.ep1.2" });
    expect((await readStatus(h.ctx, "sub_A")).status.gapPending).toBe(false);
  });

  it("dead-letter redeliver keeps body and webhook-id and bypasses inflight", async () => {
    const { h } = await setup();
    await emitAndDispatch(h, "e1");
    h.sender.script.push(status(410));
    await processDue(h.ctx);
    const [dead] = (await listDeadLetters(h.ctx, { limit: 1 })).items;
    const id = await redeliverDeadLetter(h.ctx, dead!.job.id);
    expect(id).toBe(dead!.job.id);
    expect(await inflightMembers(h)).toEqual([]);
    await processDue(h.ctx);
    expect(h.sender.calls).toHaveLength(2);
    expect(h.sender.calls[1]!.body).toBe(h.sender.calls[0]!.body);
    expect(h.sender.calls[1]!.headers["webhook-id"]).toBe(
      h.sender.calls[0]!.headers["webhook-id"]
    );
    expect(
      h.logs.some((l) => l.type === "deliver" && l.redelivery === true)
    ).toBe(true);
  });

  it("a job claimed after maxAgeAt is dead-lettered stale without an attempt (events-stale)", async () => {
    const { h } = await setup({ retryMaxAgeMs: 1000 });
    await emitAndDispatch(h, "e1");
    await h.clock.advance(2000);
    await processDue(h.ctx);
    expect(h.sender.calls).toHaveLength(0);
    expect((await listDeadLetters(h.ctx, { limit: 1 })).items[0]!.reason).toBe(
      "stale"
    );
    expect((await readStatus(h.ctx, "sub_A")).status.gapPending).toBe(true);
  });

  it("an unknown job kind is left unclaimed while a known one runs", async () => {
    const { h } = await setup();
    await h.ctx.storage.write(
      h.ctx.keys.job("x.1"),
      JSON.stringify({ v: 1, id: "x.1", kind: "future" })
    );
    await h.ctx.storage.indexAdd(h.ctx.keys.due(), "x.1", 0);
    await emitAndDispatch(h, "e1");
    await processDue(h.ctx);
    expect(h.sender.calls).toHaveLength(1);
    expect((await h.ctx.storage.read(h.ctx.keys.job("x.1")))?.value).toContain(
      "future"
    );
    expect(await processJob(h.ctx, "x.1")).toBe(false);
  });

  it("the breaker opens after consecutive connection failures without consuming attempts", async () => {
    const { h } = await setup({ breakerFailures: 1 });
    await emitAndDispatch(h, "e1");
    h.sender.script.push({ ok: false, error: "connection_refused", ms: 1 });
    await processDue(h.ctx);
    await h.clock.advance(30_000);
    // breaker open for 30 s: due again but deferred to the close time
    expect(
      JSON.parse(
        (await h.ctx.storage.read(h.ctx.keys.cb("hooks.example.com")))!.value
      ).trips
    ).toBe(1);
    await processDue(h.ctx);
    expect(h.sender.calls).toHaveLength(2);
    expect((await readAttempts(h.ctx, "sub_A")).map((a) => a.outcome)).toEqual([
      "connection_refused",
      "ack",
    ]);
  });

  it("suspension parks jobs out of due while they stay in inflight (S-21)", async () => {
    const { h } = await setup({
      suspensionMinAttempts: 2,
      retryDelaysMs: [0, 1000, 1000],
    });
    await emitAndDispatch(h, "e1");
    h.sender.script.push(status(500), status(500));
    await processDue(h.ctx);
    await h.clock.advance(1000);
    await processDue(h.ctx);
    expect((await readStatus(h.ctx, "sub_A")).status.active).toBe(false);
    await h.clock.advance(1000);
    await processDue(h.ctx);
    expect(h.sender.calls).toHaveLength(2);
    expect(await inflightMembers(h)).toHaveLength(1);
    expect(await h.ctx.storage.indexCount(h.ctx.keys.due())).toBe(0);
  });

  it("the loop guard throttles past 60/min and drops with loop_suspected at window end", async () => {
    const { h } = await setup({
      deliveriesPerSubscriptionPerMinute: 1,
      retryWindowMs: 10_000,
    });
    await emitAndDispatch(h, "e1");
    await emitAndDispatch(h, "e2");
    await processDue(h.ctx);
    expect(h.sender.calls).toHaveLength(1);
    expect(h.logs.some((l) => l.type === "loop_suspected")).toBe(true);
    expect((await readStatus(h.ctx, "sub_A")).status.gapPending).toBe(true);
  });

  it("hook jobs run onUnsubscribe at least once, retrying a throwing hook", async () => {
    const seen: string[] = [];
    let fail = true;
    const h = harness(
      registryOf(
        fakeEvent("note.created", {
          hooks: { onSubscribe: false, onUnsubscribe: true },
          runOnUnsubscribe: async (info, reason) => {
            if (fail) {
              fail = false;
              throw new Error("boom");
            }
            seen.push(`${info.id}:${reason}:${info.created}`);
          },
        })
      ),
      { retryDelaysMs: [0, 1000] }
    );
    const { enqueueHook } = await import("../../../src/events/engine/hooks.js");
    await enqueueHook(
      h.ctx,
      {
        id: "sub_A",
        name: "note.created",
        args: {},
        principal: "alice",
        dialect: "sep-3415",
        mode: "webhook",
        callbackOrigin: "https://x",
        expiresAt: null,
      },
      "revoked"
    );
    await processDue(h.ctx);
    await h.clock.advance(1000);
    await processDue(h.ctx);
    expect(seen).toEqual(["sub_A:revoked:false"]);
  });

  it("the dispatcher pointer advances past fanned-out entries", async () => {
    const { h } = await setup();
    await emitAndDispatch(h, "e1");
    await emitAndDispatch(h, "e2");
    expect((await readFanoutState(h.ctx, "note.created")).state.through).toBe(
      2
    );
  });
});
