/**
 * Test harness for engine modules: a small in-process McpUseStorage that
 * honours the clock (TTLs, CAS versions, ordered indexes, logs), template
 * keys, a scripted sender and a fake registry.
 *
 * TODO(events): switch to WP-06 `memoryStorage` and WP-12 keys once merged.
 */

import type { ProfileAxes } from "@mcp-use/events-core";
import {
  createManualClock,
  type ManualClock,
} from "../../../src/events/internal/clock.js";
import type {
  EventsRegistry,
  RegisteredEvent,
} from "../../../src/events/internal/registry.js";
import type { SubscriptionRecord } from "../../../src/events/internal/records.js";
import type { EventsLogRecord } from "../../../src/events/log-records.js";
import type {
  WebhookSendRequest,
  WebhookSendResult,
} from "../../../src/events/types.js";
import type { McpUseStorage } from "../../../src/storage/types.js";
import {
  defaultJobRuntimeConfig,
  jsonCodec,
  type EngineContext,
  type EngineKeys,
  type JobRuntimeConfig,
} from "../../../src/events/engine/jobs.js";

export function memoryStore(clock: ManualClock): McpUseStorage {
  const kv = new Map<string, { value: string; version: number; exp: number }>();
  const idx = new Map<string, Map<string, number>>();
  const logs = new Map<
    string,
    { epoch: string; entries: { seq: number; value: string }[]; head: number }
  >();
  let ver = 0;
  const live = (k: string) => {
    const e = kv.get(k);
    if (e && e.exp <= clock.now()) {
      kv.delete(k);
      return undefined;
    }
    return e;
  };
  const sorted = (name: string) =>
    [...(idx.get(name) ?? new Map()).entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1));
  const store = {
    kind: "test-memory",
    durable: false,
    shared: false,
    capabilities: { signal: false, batch: false },
    async get(k: string) {
      return live(k)?.value;
    },
    async set(k: string, v: string, ttl?: number) {
      kv.set(k, {
        value: v,
        version: ++ver,
        exp: ttl ? clock.now() + ttl : Infinity,
      });
    },
    async delete(k: string) {
      kv.delete(k);
    },
    async read(k: string) {
      const e = live(k);
      return e ? { value: e.value, version: String(e.version) } : undefined;
    },
    async write(
      k: string,
      value: string,
      o: { ifVersion?: string | null; ttlMs?: number } = {}
    ) {
      const e = live(k);
      if (o.ifVersion === null && e) return false;
      if (
        typeof o.ifVersion === "string" &&
        (!e || String(e.version) !== o.ifVersion)
      )
        return false;
      const version = ++ver;
      kv.set(k, {
        value,
        version,
        exp: o.ttlMs ? clock.now() + o.ttlMs : Infinity,
      });
      return String(version);
    },
    async remove(k: string) {
      return kv.delete(k);
    },
    async incr(k: string, o: { ttlMs: number; by?: number }) {
      const e = live(k);
      const n = (e ? Number(e.value) : 0) + (o.by ?? 1);
      kv.set(k, {
        value: String(n),
        version: ++ver,
        exp: e?.exp ?? clock.now() + o.ttlMs,
      });
      return n;
    },
    async indexAdd(
      name: string,
      member: string,
      score: number,
      o: { onlyIfAbsent?: boolean } = {}
    ) {
      const m = idx.get(name) ?? new Map<string, number>();
      idx.set(name, m);
      if (o.onlyIfAbsent && m.has(member)) return;
      m.set(member, score);
    },
    async indexRemove(name: string, member: string) {
      idx.get(name)?.delete(member);
    },
    async indexRange(
      name: string,
      q: { min?: number; max?: number; after?: string; limit: number }
    ) {
      let items = sorted(name).filter(
        (e) =>
          (q.min === undefined || e.score >= q.min) &&
          (q.max === undefined || e.score <= q.max)
      );
      const start = q.after ? Number(q.after) : 0;
      items = items.slice(start);
      const page = items.slice(0, q.limit);
      return items.length > q.limit
        ? { items: page, next: String(start + q.limit) }
        : { items: page };
    },
    async indexCount(name: string, q: { min?: number; max?: number } = {}) {
      return sorted(name).filter(
        (e) =>
          (q.min === undefined || e.score >= q.min) &&
          (q.max === undefined || e.score <= q.max)
      ).length;
    },
    async logAppend(stream: string, value: string, o: { maxEvents: number }) {
      const l = logs.get(stream) ?? { epoch: "ep1", entries: [], head: 0 };
      logs.set(stream, l);
      l.head += 1;
      l.entries.push({ seq: l.head, value });
      while (l.entries.length > o.maxEvents) l.entries.shift();
      return { duplicate: false as const, seq: l.head, epoch: l.epoch };
    },
    async logRange(stream: string, o: { after: number | null; limit: number }) {
      const l = logs.get(stream);
      if (!l) return { entries: [], epoch: null, first: 0, head: 0 };
      const after = o.after ?? 0;
      return {
        entries: l.entries.filter((e) => e.seq > after).slice(0, o.limit),
        epoch: l.epoch,
        first: l.entries[0]?.seq ?? l.head + 1,
        head: l.head,
      };
    },
    async logTrim(stream: string, o: { before: number }) {
      const l = logs.get(stream);
      if (!l) return 0;
      const n = l.entries.length;
      l.entries = l.entries.filter((e) => e.seq >= o.before);
      return n - l.entries.length;
    },
    async logDelete(stream: string) {
      logs.delete(stream);
    },
  };
  return store as unknown as McpUseStorage;
}

export function templateKeys(ns = "t"): EngineKeys {
  const p = `ev:{${ns}}:`;
  return {
    job: (id) => `${p}job:${id}`,
    due: () => `${p}due`,
    dead: (id) => `${p}dead:${id}`,
    deadIdx: () => `${p}dead`,
    inflight: (id) => `${p}inflight:${id}`,
    attempts: (id) => `${p}attempts:${id}`,
    sub: (id) => `${p}sub:${id}`,
    status: (id) => `${p}status:${id}`,
    tomb: (id) => `${p}tomb:${id}`,
    cb: (h) => `${p}cb:${h}`,
    log: (n) => `${p}log:${n}`,
    fanout: (n) => `${p}fanout:${n}`,
    fanoutDue: () => `${p}fanout-due`,
    lockFanout: (n) => `${p}lock:fanout:${n}`,
    byName: (n) => `${p}by-name:${n}`,
    byNamePartition: (n, part) => `${p}by-name:${n}:p:${part}`,
    byNamePartitioned: (n) => `${p}by-name:${n}:p:*`,
    verified: (pr, u) => `${p}verified:${pr}|${u}`,
    verifyFail: (pr, u) => `${p}verifyfail:${pr}|${u}`,
    rlVerifyPrincipal: (pr, h, m) => `${p}rl:verify:${pr}:${h}:${m}`,
    rlVerifyHost: (h, m) => `${p}rl:verify:${h}:${m}`,
    inflightVerify: (h) => `${p}inflight-verify:${h}`,
  };
}

/** A scripted sender: each call shifts the next response (default 200). */
export class ScriptedSender {
  readonly calls: WebhookSendRequest[] = [];
  readonly script: Array<
    WebhookSendResult | ((r: WebhookSendRequest) => WebhookSendResult)
  > = [];
  send = async (r: WebhookSendRequest): Promise<WebhookSendResult> => {
    this.calls.push(r);
    const next = this.script.shift();
    if (typeof next === "function") return next(r);
    return next ?? status(200);
  };
}

export function status(
  code: number,
  headers: Record<string, string> = {},
  body = ""
): WebhookSendResult {
  return { ok: true, status: code, headers, body, ms: 1 };
}

export function fakeEvent(
  name: string,
  o: Partial<RegisteredEvent> & { unsubscribed?: unknown[] } = {}
): RegisteredEvent {
  return {
    name,
    definition: {} as never,
    inputJsonSchema: {},
    payloadJsonSchema: {},
    schemaHash: "h",
    replay: { maxAgeMs: 86_400_000, maxEvents: 1000 },
    partitionBy: null,
    hooks: { onSubscribe: false, onUnsubscribe: false },
    validatePayload: async (d) => d,
    match: async () => true,
    runOnUnsubscribe: async () => {},
    ...o,
  };
}

export function registryOf(...events: RegisteredEvent[]): EventsRegistry {
  const m = new Map(events.map((e) => [e.name, e]));
  return {
    size: m.size,
    get: (n) => m.get(n),
    all: () => [...m.values()],
    catalogHash: "cat",
  };
}

export const SEP_AXES: ProfileAxes = {
  webhookId: "random",
  eventIdNormalization: "none",
  errorCodes: "sep",
  unsubscribeMissing: "notFound",
  controlEnvelopes: true,
  refreshDeliveryStatus: true,
  listedModes: "servable",
  replayCursors: true,
};

export const OPENAI_AXES: ProfileAxes = {
  webhookId: "eventId",
  eventIdNormalization: "headerSafe",
  errorCodes: "sketch",
  unsubscribeMissing: "empty",
  controlEnvelopes: false,
  refreshDeliveryStatus: false,
  listedModes: "webhookOnly",
  replayCursors: false,
};

export interface Harness {
  ctx: EngineContext;
  clock: ManualClock;
  sender: ScriptedSender;
  logs: EventsLogRecord[];
}

export function harness(
  registry: EventsRegistry,
  config: Partial<JobRuntimeConfig> = {}
): Harness {
  const clock = createManualClock(1_700_000_000_000, 42);
  const sender = new ScriptedSender();
  const logs: EventsLogRecord[] = [];
  const ctx: EngineContext = {
    storage: memoryStore(clock),
    keys: templateKeys(),
    codec: jsonCodec,
    clock,
    registry,
    send: sender.send,
    log: (r) => logs.push(r),
    owner: "inst-1",
    config: defaultJobRuntimeConfig({ retryJitter: 0, ...config }),
    cursor: (_name, epoch, seq) => `c1.${epoch}.${seq}`,
  };
  return { ctx, clock, sender, logs };
}

export const SECRET = "whsec_" + Buffer.alloc(32, 7).toString("base64");

export async function putSubscription(
  h: Harness,
  o: Partial<SubscriptionRecord> & { id: string; name: string }
): Promise<SubscriptionRecord> {
  const sub: SubscriptionRecord = {
    v: 1,
    principal: "alice",
    args: {},
    argsHash: "a",
    partition: null,
    url: "https://hooks.example.com/in",
    secret: SECRET,
    profile: { preset: "sep-3415", revision: 1, axes: SEP_AXES, via: "test" },
    createdAt: h.clock.now(),
    refreshedAt: h.clock.now(),
    expiresAt: h.clock.now() + 86_400_000,
    verifiedVia: "challenge",
    catalogHash: "cat",
    start: { epoch: "ep1", seq: 0 },
    meta: { era: "modern", declared: true, mcpName: "present" },
    ...o,
  };
  await h.ctx.storage.write(h.ctx.keys.sub(sub.id), JSON.stringify(sub));
  await h.ctx.storage.indexAdd(
    sub.partition === null
      ? h.ctx.keys.byName(sub.name)
      : h.ctx.keys.byNamePartition(sub.name, sub.partition),
    sub.id,
    sub.createdAt
  );
  return sub;
}

export async function appendEvent(
  h: Harness,
  name: string,
  id: string,
  data: unknown,
  extra: Record<string, unknown> = {}
): Promise<number> {
  const r = await h.ctx.storage.logAppend(
    h.ctx.keys.log(name),
    JSON.stringify({
      v: 1,
      k: "e",
      id,
      ts: "2026-11-24T10:00:00.000Z",
      at: h.clock.now(),
      data,
      partition: null,
      ...extra,
    }),
    { maxEvents: 1000 }
  );
  await h.ctx.storage.indexAdd(h.ctx.keys.fanoutDue(), name, h.clock.now());
  return (r as { seq: number }).seq;
}
