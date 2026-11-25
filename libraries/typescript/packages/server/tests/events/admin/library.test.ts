import { describe, expect, it } from "vitest";
import {
  openEventsAdmin,
  openEventsAdminWith,
} from "../../../src/events/admin/open.js";
import { adminKeys } from "../../../src/events/admin/status.js";
import { plainCodec } from "../../../src/events/admin/views.js";
import { ns16 } from "../../../src/events/binding/namespace.js";
import type { DeadLetter } from "../../../src/events/internal/records.js";
import { ReferenceDatabase } from "../../storage/reference-storage.js";

const NOW = Date.UTC(2026, 0, 1);

async function setup() {
  const storage = new ReferenceDatabase().store("t/");
  const keys = adminKeys(await ns16("srv:prod"));
  return { storage, keys };
}

describe("admin library", () => {
  it("reports an empty namespace without a keyring", async () => {
    const { storage } = await setup();
    const admin = openEventsAdmin({ storage, namespace: "srv:prod" });
    expect(await admin.status()).toEqual({
      layout: null,
      closed: false,
      due: 0,
      fanoutDue: 0,
      oldestDueAgeMs: null,
      nextWakeAt: null,
      deadLetters: 0,
      subscriptions: 0,
      leases: 0,
    });
    expect(await admin.nextWakeAt()).toBeNull();
  });

  it("computes nextWakeAt as the min of due and fanout-due without a keyring", async () => {
    const { storage, keys } = await setup();
    await storage.write(
      keys.meta,
      JSON.stringify({ v: 1, layout: 1, createdAt: 0, cursorKey: "sealed" })
    );
    await storage.indexAdd(keys.due, "d.1", NOW + 5000);
    await storage.indexAdd(keys.fanoutDue, "orders", NOW + 1000);
    const admin = openEventsAdminWith(
      { storage, namespace: "srv:prod" },
      { now: () => NOW + 3000 }
    );
    expect((await admin.nextWakeAt())?.toISOString()).toBe(
      new Date(NOW + 1000).toISOString()
    );
    const s = await admin.status();
    expect([s.layout, s.due, s.fanoutDue, s.oldestDueAgeMs]).toEqual([
      1, 1, 1, 0,
    ]);
  });

  it("refuses keyed reads without a keyring", async () => {
    const { storage } = await setup();
    const admin = openEventsAdmin({ storage, namespace: "srv:prod" });
    await expect(admin.catalog()).rejects.toMatchObject({
      code: "EVENTS_SECRET_REQUIRED",
    });
  });

  it("lists and redelivers a dead letter with the same webhook-id", async () => {
    const { storage, keys } = await setup();
    const dead: DeadLetter = {
      v: 1,
      reason: "exhausted",
      at: NOW,
      job: {
        v: 1,
        id: "d.abc",
        kind: "deliver",
        createdAt: NOW - 60_000,
        subscriptionId: "sub_1",
        epoch: "e1",
        seq: 7,
        eventId: "evt_1",
        webhookId: "msg_1",
        body: "{}",
        bodyBytes: 2,
        attempt: 5,
        delays: [0],
        firstAttemptAt: NOW - 60_000,
        lastAttemptAt: NOW,
        pausedMs: 0,
        nextAt: NOW,
        maxAgeAt: NOW - 60_000 + 86_400_000,
      },
    };
    await storage.write(keys.deadLetter("d.abc"), JSON.stringify(dead));
    await storage.indexAdd(keys.dead, "d.abc", NOW);
    const admin = openEventsAdminWith(
      { storage, namespace: "srv:prod" },
      { codec: plainCodec, now: () => NOW }
    );
    const list = await admin.deadLetters();
    expect(list.items).toEqual([
      {
        id: "d.abc",
        kind: "deliver",
        subscriptionId: "sub_1",
        name: null,
        eventId: "evt_1",
        webhookId: "msg_1",
        reason: "exhausted",
        abandonedAt: new Date(NOW).toISOString(),
        attempts: 5,
        lastError: null,
        callbackOrigin: "",
        bodyBytes: 2,
      },
    ]);
    expect(await admin.redeliver("d.abc")).toEqual({ jobId: "d.abc" });
    const job = JSON.parse((await storage.read(keys.job("d.abc")))!.value);
    expect([job.webhookId, job.body, job.attempt, job.redelivery]).toEqual([
      "msg_1",
      "{}",
      0,
      true,
    ]);
    expect((await admin.status()).deadLetters).toBe(0);
    expect((await admin.nextWakeAt())?.getTime()).toBe(NOW);
  });

  it("requires principal or subscriptionId for revoke", async () => {
    const { storage } = await setup();
    const admin = openEventsAdminWith(
      { storage, namespace: "srv:prod" },
      { revoke: async () => ({ removed: 3 }) }
    );
    await expect(admin.revoke({ name: "x" })).rejects.toMatchObject({
      code: "EVENTS_CONFIG_INVALID",
    });
    expect(await admin.revoke({ principal: "u1" })).toEqual({ removed: 3 });
  });

  it("purges the namespace and leaves closed", async () => {
    const { storage, keys } = await setup();
    await storage.write(keys.meta, JSON.stringify({ v: 1, layout: 1 }));
    await storage.write(keys.job("d.1"), "x");
    await storage.indexAdd(keys.due, "d.1", NOW);
    const other = adminKeys(await ns16("srv:other"));
    await storage.write(other.meta, "keep");
    const admin = openEventsAdmin({ storage, namespace: "srv:prod" });
    const r = await admin.purge();
    expect(r.deletedKeys).toBeGreaterThanOrEqual(2);
    const s = await admin.status();
    expect([s.closed, s.due, s.layout]).toEqual([true, 0, null]);
    expect((await storage.read(other.meta))?.value).toBe("keep");
  });
});
