import { describe, expect, it } from "vitest";
import type { EventsAdmin } from "../../src/events/admin/types.js";
import {
  createEventsRouter,
  type EventsRoutesDeps,
} from "../../src/events/routes/index.js";
import type { RouteAuthConfig } from "../../src/events/routes/auth.js";
import { runDecommission } from "../../src/events/routes/decommission.js";
import { adminKeys } from "../../src/events/admin/status.js";
import { ns16 } from "../../src/events/binding/namespace.js";
import { ReferenceDatabase } from "../storage/reference-storage.js";

const BASE = "https://app.example/mcp/_mcp-use/events";

function router(auth: RouteAuthConfig, over: Partial<EventsRoutesDeps> = {}) {
  const emitted: unknown[] = [];
  const r = createEventsRouter({
    basePath: () => "/mcp",
    auth: () => auth,
    tick: async () => ({
      attempted: 1,
      expired: 0,
      remaining: 0,
      nextWakeAt: null,
    }),
    health: async () => ({ state: "ready" }) as never,
    emit: async () => ({
      namespace: "srv:prod",
      nsHash: "HASH",
      dev: auth.devToken !== undefined,
      emit: async (req) => {
        emitted.push(req);
        return { eventId: req.eventId, duplicate: false, accepted: true };
      },
    }),
    admin: async () =>
      ({
        subscriptions: async (q: unknown) => ({ items: [], q }),
      }) as unknown as EventsAdmin,
    streams: async () => [],
    decommission: async (b) => ({
      terminated: 0,
      hooks: 0,
      undelivered: 0,
      purged: 0,
      b,
    }),
    ...over,
  });
  return { r, emitted };
}

const req = (path: string, init: RequestInit & { token?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.token !== undefined)
    headers.set("authorization", `Bearer ${init.token}`);
  return new Request(`${BASE}/${path}`, { ...init, headers });
};

describe("internal routes auth (D41)", () => {
  it("ignores paths outside the prefix", async () => {
    const { r } = router({ tick: ["t"], admin: [] });
    expect(await r(new Request("https://app.example/mcp"))).toBeUndefined();
  });

  it("disables routes without any secret", async () => {
    const { r } = router({ tick: [], admin: [] });
    expect((await r(req("tick", { token: "x" })))?.status).toBe(404);
  });

  it("accepts the tick secret on tick only", async () => {
    const { r } = router({ tick: ["t1", "t2"], admin: ["a1"] });
    const ok = await r(req("tick", { token: "t2" }));
    expect([ok?.status, await ok?.json()]).toEqual([
      200,
      { attempted: 1, expired: 0, remaining: 0, nextWakeAt: null },
    ]);
    expect((await r(req("health", { token: "t1" })))?.status).toBe(401);
    expect((await r(req("health", { token: "a1" })))?.status).toBe(200);
    expect((await r(req("tick")))?.status).toBe(401);
  });

  it("accepts the dev token except on decommission", async () => {
    const { r } = router({ tick: [], admin: [], devToken: "dev" });
    expect((await r(req("health", { token: "dev" })))?.status).toBe(200);
    expect(
      (await r(req("admin/decommission", { method: "POST", token: "dev" })))
        ?.status
    ).toBe(404);
  });

  it("requires the confirm header on emit outside dev and prefixes test ids", async () => {
    const { r, emitted } = router({ tick: [], admin: ["a"] });
    const body = JSON.stringify({
      name: "orders",
      data: { n: 1 },
      eventId: "e1",
    });
    expect(
      (await r(req("emit", { method: "POST", token: "a", body })))?.status
    ).toBe(400);
    const ok = await r(
      req("emit", {
        method: "POST",
        token: "a",
        body,
        headers: { "x-mcp-use-confirm": "HASH" },
      })
    );
    expect(await ok?.json()).toEqual({
      eventId: "test_e1",
      duplicate: false,
      accepted: true,
    });
    expect(emitted).toEqual([
      { name: "orders", data: { n: 1 }, eventId: "test_e1" },
    ]);
  });

  it("passes admin query parameters to the library and rejects bad decommission deadlines", async () => {
    const { r } = router({ tick: [], admin: ["a"] });
    const res = await r(
      req("admin/subscriptions?name=orders&limit=5", { token: "a" })
    );
    expect(await res?.json()).toEqual({
      items: [],
      q: { name: "orders", limit: 5 },
    });
    const bad = await r(
      req("admin/decommission", {
        method: "POST",
        token: "a",
        body: JSON.stringify({ deadlineMs: 500_000 }),
      })
    );
    expect(bad?.status).toBe(400);
    expect(
      (await r(req("tick", { method: "DELETE", token: "a" })))?.status
    ).toBe(405);
  });
});

describe("decommission (D68)", () => {
  it("revokes, closes logs, drains, purges and leaves closed; idempotent", async () => {
    const storage = new ReferenceDatabase().store();
    const keys = adminKeys(await ns16("srv:prod"));
    await storage.write(keys.job("c.1"), "x");
    await storage.indexAdd(keys.due, "c.1", 1);
    const calls: string[] = [];
    let first = true;
    const steps = {
      revokeAll: async (reason: string) => {
        calls.push(`revoke:${reason}`);
        const out = first
          ? { terminated: 2, hooks: 3 }
          : { terminated: 0, hooks: 0 };
        first = false;
        return out;
      },
      closeLogs: async () => void calls.push("close"),
      drain: async () => {
        calls.push("drain");
        return { undelivered: 0 };
      },
    };
    const r1 = await runDecommission(storage, keys, steps, {
      reason: "deleted",
      deadlineMs: 1000,
    });
    expect([r1.terminated, r1.hooks, r1.undelivered]).toEqual([2, 3, 0]);
    expect(r1.purged).toBeGreaterThanOrEqual(1);
    expect(calls).toEqual(["revoke:closed", "close", "drain"]);
    expect(JSON.parse((await storage.read(keys.closed))!.value).reason).toBe(
      "deleted"
    );
    const r2 = await runDecommission(storage, keys, steps, {
      reason: "deleted",
      deadlineMs: 1000,
    });
    expect([r2.terminated, r2.hooks, r2.undelivered]).toEqual([0, 0, 0]);
  });
});
