import { EventsError, deriveSubscriptionId } from "@mcp-use/events-core";
import type { ProfileAxes } from "@mcp-use/events-core";
import { describe, expect, it } from "vitest";
import { listEvents } from "../../../src/events/engine/list.js";
import { checkCreateQuotas } from "../../../src/events/engine/quotas.js";
import {
  handleSubscribe,
  isValidWebhookSecret,
  type SubscribeDeps,
} from "../../../src/events/engine/subscribe.js";
import { grantTtl } from "../../../src/events/engine/ttl.js";
import { handleUnsubscribe } from "../../../src/events/engine/unsubscribe.js";
import type {
  EventsBackend,
  SubscribeInput,
} from "../../../src/events/internal/backend.js";
import type { SubscriptionRecord } from "../../../src/events/internal/records.js";
import { event, registry } from "./fixtures.js";

const SEP: ProfileAxes = {
  webhookId: "random",
  eventIdNormalization: "none",
  errorCodes: "sep",
  unsubscribeMissing: "notFound",
  controlEnvelopes: true,
  refreshDeliveryStatus: true,
  listedModes: "servable",
  replayCursors: true,
};
const OPENAI: ProfileAxes = {
  ...SEP,
  unsubscribeMissing: "empty",
  listedModes: "webhookOnly",
  replayCursors: false,
  refreshDeliveryStatus: false,
};
const SECRET = `whsec_${btoa("x".repeat(32))}`;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A backend holding subscriptions in a map, keyed by derived id. */
function subBackend() {
  const records = new Map<string, SubscriptionRecord>();
  const inputs: SubscribeInput[] = [];
  const backend = {
    capabilities: { durable: true, shared: true, maxTtlMs: 30 * DAY, allowNoExpiry: true, maxPayloadBytes: 1e6, signal: false, tail: "shared" },
    async isRevoked() {
      return false;
    },
    async subscribe(input: SubscribeInput, ctx: { now: number }) {
      inputs.push(input);
      const id = await deriveSubscriptionId({ ...input.key, arguments: input.key.args });
      const created = !records.has(id);
      records.set(id, {
        id, principal: input.key.principal, name: input.key.name, args: input.key.args,
        url: input.key.url, start: { epoch: "e1", seq: 0 },
        expiresAt: input.grantTtlMs === null ? null : ctx.now + input.grantTtlMs,
      } as SubscriptionRecord);
      return {
        id, created, refreshBefore: null, cursor: input.cursor ?? "c.e1.0", truncated: false,
        deliveryStatus: { active: true, lastDeliveryAt: null, lastError: null },
      };
    },
    async unsubscribe(key: { principal: string; url: string; name: string; args: Record<string, unknown> }) {
      const id = await deriveSubscriptionId({ ...key, arguments: key.args });
      const r = records.get(id);
      records.delete(id);
      return { removed: r ? ({ id } as never) : null };
    },
  };
  return { records, inputs, backend: backend as unknown as EventsBackend };
}

function setup(over: Partial<SubscribeDeps> = {}, evOver: Parameters<typeof event>[1] = {}) {
  const b = subBackend();
  const deps: SubscribeDeps = {
    registry: registry(event("note.created", evOver)),
    backend: b.backend,
    now: () => 1_000_000,
    axes: SEP,
    profile: { preset: "sep-3415", revision: 1, axes: SEP, via: "default" },
    meta: { era: "modern", declared: true, mcpName: "present" },
    env: { webhookPrincipalSource: true, pollEnabled: true, pushEnabled: true },
    isDormant: () => false,
    isVisible: async () => true,
    trustedOrigin: () => false,
    validateArgs: async (_e, a) => a,
    principal: () => "iss|alice",
    authorize: async () => true,
    isClosed: async () => false,
    findRecord: async (id) => b.records.get(id) ?? null,
    quotaCounts: { byPrincipal: async () => 0, anonymousByUrl: async () => 0, anonymous: async () => 0, all: async () => 0 },
    verify: async () => {},
    onSubscribe: async () => {},
    ...over,
  };
  return { ...b, deps };
}

const params = (o: Record<string, unknown> = {}) => ({
  name: "note.created",
  delivery: { url: "https://hook.example/cb", secret: SECRET },
  ...o,
});

describe("events/subscribe validation order (§6.7)", () => {
  it("creates a subscription with a 24 h default grant", async () => {
    const { deps } = setup();
    expect(await handleSubscribe(params(), deps)).toEqual({
      id: await deriveSubscriptionId({ principal: "iss|alice", url: "https://hook.example/cb", name: "note.created", arguments: {} }),
      refreshBefore: new Date(1_000_000 + DAY).toISOString(),
      cursor: "c.e1.0",
      truncated: false,
    });
  });

  it("applies the steps in order", async () => {
    const cases: Array<[Record<string, unknown>, Partial<SubscribeDeps>, Record<string, unknown>]> = [
      [params({ name: "nope" }), {}, { kind: "notFound", data: { kind: "event" } }],
      [params({ delivery: { mode: "poll" } }), {}, { kind: "unsupported", data: { feature: "deliveryMode", value: "poll" } }],
      [params({ delivery: { url: "http://hook.example/cb", secret: SECRET } }), {}, { data: { field: "delivery.url" } }],
      [params({ delivery: { url: "https://u:p@hook.example/cb", secret: SECRET } }), {}, { data: { field: "delivery.url" } }],
      [params({ delivery: { url: "https://hook.example/cb", secret: "whsec_abc" } }), {}, { data: { field: "delivery.secret" } }],
      [params({ maxAgeMs: -1 }), {}, { data: { field: "maxAgeMs" } }],
      [params(), { principal: () => null }, { kind: "forbidden", data: { reason: "principal_required" } }],
      [params(), { authorize: async () => false }, { data: { reason: "not_authorized" } }],
      [params(), { isClosed: async () => true }, { data: { reason: "closed" } }],
    ];
    for (const [p, over, expected] of cases)
      await expect(handleSubscribe(p, setup(over).deps)).rejects.toMatchObject(expected);
  });

  it("answers NotFound for a hidden or dormant event", async () => {
    await expect(handleSubscribe(params(), setup({ isVisible: async () => false }).deps)).rejects.toMatchObject({ kind: "notFound" });
    await expect(handleSubscribe(params(), setup({ isDormant: () => true }).deps)).rejects.toMatchObject({ kind: "notFound" });
  });

  it("checks quotas and verification on create only", async () => {
    const verified: string[] = [];
    const s = setup({ verify: async (url) => void verified.push(url) });
    await handleSubscribe(params(), s.deps);
    s.deps.quotaCounts.byPrincipal = async () => 100;
    const refresh = await handleSubscribe(params(), s.deps);
    expect(verified).toEqual(["https://hook.example/cb"]);
    expect(refresh.deliveryStatus).toEqual({ active: true, lastDeliveryAt: null, lastError: null });
  });

  it("ignores the cursor on refresh of a live record and passes it on create", async () => {
    const s = setup();
    await handleSubscribe(params({ cursor: "c.e1.5" }), s.deps);
    await handleSubscribe(params({ cursor: "c.e1.9" }), s.deps);
    expect(s.inputs.map((i) => i.cursor)).toEqual(["c.e1.5", null]);
  });

  it("returns null cursors under replayCursors false", async () => {
    const s = setup({ axes: OPENAI, env: { webhookPrincipalSource: true, pollEnabled: true, pushEnabled: true } });
    const r = await handleSubscribe(params({ cursor: "c.e1.5" }), s.deps);
    expect([r.cursor, r.truncated, s.inputs[0]!.cursor]).toEqual([null, false, null]);
  });

  it("rolls the record back when onSubscribe throws", async () => {
    const s = setup(
      { onSubscribe: async () => { throw new EventsError("forbidden", "", { reason: "not_authorized" }); } },
      { hooks: { onSubscribe: true, onUnsubscribe: false } }
    );
    await expect(handleSubscribe(params(), s.deps)).rejects.toMatchObject({ kind: "forbidden" });
    expect(s.records.size).toBe(0);
  });
});

describe("secrets, TTL and quotas", () => {
  it("accepts 24 to 64 decoded bytes of standard base64", () => {
    expect(isValidWebhookSecret(`whsec_${btoa("x".repeat(24))}`)).toBe(true);
    expect(isValidWebhookSecret(`whsec_${btoa("x".repeat(23))}`)).toBe(false);
    expect(isValidWebhookSecret(`whsec_${btoa("x".repeat(65))}`)).toBe(false);
    expect(isValidWebhookSecret(`whsec_${"a-b_".repeat(10)}`)).toBe(false);
  });

  const backend = { durable: true, maxTtlMs: 30 * DAY, allowNoExpiry: true };
  it("grants TTLs per D21", () => {
    expect(grantTtl({ requested: undefined, backend })).toBe(DAY);
    expect(grantTtl({ requested: 1000, backend })).toBe(5 * 60_000);
    expect(grantTtl({ requested: 30 * DAY, backend })).toBe(7 * DAY);
    expect(grantTtl({ requested: undefined, rowDefaultMs: 2 * DAY, backend })).toBe(2 * DAY);
    expect(grantTtl({ requested: undefined, eventTtl: { default: "1h" }, backend })).toBe(HOUR);
    expect(grantTtl({ requested: null, backend })).toBe(7 * DAY);
    expect(grantTtl({ requested: null, backend, allowNoExpiry: true })).toBe(null);
    expect(grantTtl({ requested: undefined, backend: { ...backend, maxTtlMs: HOUR } })).toBe(HOUR);
  });

  it("enforces anonymous per-URL and per-principal quotas", async () => {
    const counts = { byPrincipal: async () => 100, anonymousByUrl: async () => 20, anonymous: async () => 0, all: async () => 0 };
    await expect(checkCreateQuotas({ principal: "anonymous", url: "u" }, counts)).rejects.toMatchObject({
      kind: "resourceExhausted",
      data: { limit: "anonymousSubscriptionsPerUrl", max: 20 },
    });
    await expect(checkCreateQuotas({ principal: "iss|a", url: "u" }, counts)).rejects.toMatchObject({
      data: { limit: "subscriptionsPerPrincipal", max: 100 },
    });
  });
});

describe("events/list (§6.6, D26)", () => {
  const env = { webhookPrincipalSource: true, pollEnabled: true, pushEnabled: true };
  const reg = registry(
    event("a"),
    event("b", { replay: false }),
    event("c", { definition: { delivery: { webhook: false } } }),
    event("hidden")
  );
  const list = (axes: Pick<ProfileAxes, "listedModes">, e = env) =>
    listEvents({ registry: reg, axes, env: e, isVisible: async (ev) => ev.name !== "hidden" });

  it("lists available modes in sep order and omits hidden events", async () => {
    const r = await list(SEP);
    expect(r.events.map((e) => [e.name, e.delivery])).toEqual([
      ["a", ["webhook", "push", "poll"]],
      ["b", ["webhook", "push"]],
      ["c", ["push", "poll"]],
    ]);
  });

  it("lists only webhook for openai and omits events without it", async () => {
    const r = await list(OPENAI);
    expect(r.events.map((e) => [e.name, e.delivery])).toEqual([
      ["a", ["webhook"]],
      ["b", ["webhook"]],
    ]);
  });

  it("pages by 100 and restarts on a stale catalog hash", async () => {
    const many = registry(...Array.from({ length: 150 }, (_, i) => event(`e${i}`)));
    const p1 = await listEvents({ registry: many, axes: SEP, env, isVisible: async () => true });
    const p2 = await listEvents({ registry: many, axes: SEP, env, isVisible: async () => true, cursor: p1.nextCursor! });
    expect([p1.events.length, p2.events.length, p2.nextCursor]).toEqual([100, 50, undefined]);
    const stale = await listEvents({ registry: { ...many, catalogHash: "other" }, axes: SEP, env, isVisible: async () => true, cursor: p1.nextCursor! });
    expect(stale.events[0]!.name).toBe("e0");
  });
});

describe("events/unsubscribe (§6.8)", () => {
  it("answers NotFound under sep and {} under openai when nothing matches", async () => {
    const { backend } = subBackend();
    const p = { name: "note.created", delivery: { url: "https://hook.example/cb" } };
    const base = { backend, principal: () => "iss|alice", now: () => 0 };
    await expect(handleUnsubscribe(p, { ...base, axes: SEP })).rejects.toMatchObject({ kind: "notFound", data: { kind: "subscription" } });
    expect(await handleUnsubscribe(p, { ...base, axes: OPENAI })).toEqual({});
  });
});
