import { describe, expect, it } from "vitest";
import { runSweep } from "../../../src/events/engine/sweep.js";
import type { EventsBackend, ProcessDeps } from "../../../src/events/internal/backend.js";
import type { DirectLease } from "../../../src/events/internal/records.js";
import { event, registry } from "./fixtures.js";

const lease: DirectLease = {
  v: 1, id: "sub_l", name: "a", principal: "iss|a", args: { f: 1 },
  modes: ["poll"], createdAt: 0, touchedAt: 0, expiresAt: 500,
};

function deps(leader: boolean) {
  const hooks: unknown[] = [];
  const backend = {
    async sweep() {
      return { expired: 3 };
    },
    async expiredLeases() {
      return [lease];
    },
    async revoke() {
      return { removed: [] };
    },
    async append() {
      return [];
    },
  } as unknown as EventsBackend;
  return {
    hooks,
    d: {
      backend,
      registry: registry(event("a", { hooks: { onSubscribe: false, onUnsubscribe: true } })),
      process: { owner: "i1" } as ProcessDeps,
      leader: { tryAcquire: async () => leader },
      enqueueHook: async (reason: "expired", snap: unknown) => void hooks.push([reason, snap]),
      now: () => 0,
    },
  };
}

describe("sweeper", () => {
  it("does nothing without the leader lease", async () => {
    const { d, hooks } = deps(false);
    expect(await runSweep(d)).toEqual({ leader: false, expired: 0, leasesExpired: 0, removedEvents: [] });
    expect(hooks).toEqual([]);
  });

  it("expires records and enqueues expired hooks for leases", async () => {
    const { d, hooks } = deps(true);
    expect(await runSweep(d)).toEqual({ leader: true, expired: 3, leasesExpired: 1, removedEvents: [] });
    expect(hooks).toEqual([
      ["expired", { id: "sub_l", name: "a", args: { f: 1 }, principal: "iss|a", dialect: "sep-3415", mode: "poll", callbackOrigin: null, expiresAt: 500 }],
    ]);
  });

  it("removes events missing from the catalog for 24 h", async () => {
    const { d } = deps(true);
    let missing: Record<string, number> = { old: 0 };
    const r = await runSweep({
      ...d,
      now: () => 86_400_000,
      catalog: {
        read: async () => ({ record: null, version: null }),
        write: async () => true,
        readMissing: async () => ({ ...missing }),
        writeMissing: async (m) => void (missing = m),
      },
    });
    expect([r.removedEvents, missing]).toEqual([["old"], {}]);
  });
});
