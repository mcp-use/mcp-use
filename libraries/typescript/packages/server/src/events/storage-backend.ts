/**
 * The one `EventsBackend` implementation over `McpUseStorage` (§8.6, WP-20).
 *
 * It composes the store layer (keys, sealing, meta), the event log (WP-12)
 * and the job engine (WP-14…WP-17) behind the internal engine/state
 * boundary. Every operation is expressed in the `McpUseStorage` primitives,
 * so the same code runs on every adapter.
 *
 * @internal
 */

import { canonicalJson } from "@mcp-use/events-core";
import type { McpUseStorage } from "../storage/types.js";
import type {
  AppendItem,
  EventsBackend,
  ProcessDeps,
  SubscriptionGrant,
  SubscriptionKey,
} from "./internal/backend.js";
import type { Clock } from "./internal/clock.js";
import type {
  DirectLease,
  FanoutState,
  SubscriptionRecord,
} from "./internal/records.js";
import { resolveCursor } from "./engine/cursor.js";
import { indexSubscription, pageSubscriptions } from "./engine/fanout-index.js";
import {
  defaultJobRuntimeConfig,
  digest,
  jsonCodec,
  type EngineContext,
  type EngineKeys,
  type JobRuntimeConfig,
} from "./engine/jobs.js";
import { createEventLog, type EventLog } from "./engine/log.js";
import { processDue, processJob, nextWakeAt } from "./engine/process.js";
import { createEventsKeyring } from "./store/keyring.js";
import { createEventsKeys, type EventsKeys } from "./store/keys.js";
import { ensureMeta } from "./store/meta.js";
import { createSealer, plaintextSealer, type Sealer } from "./store/seal.js";
import type { EventsHealth, SubscriptionView } from "./types.js";

/** Inputs of {@link storageBackend}. */
export interface StorageBackendOptions {
  storage: McpUseStorage;
  namespace: string;
  keyring: readonly string[];
  /** Dev runtime: no sealing (D22). */
  unsealed?: boolean;
  durable: boolean;
  shared: boolean;
  clock: Clock;
  /** Opaque binding prefix (`MCP_USE_STORAGE_PREFIX`). */
  prefix?: string;
  /** Job runtime overrides (retry schedule, concurrency). */
  jobs?: Partial<JobRuntimeConfig>;
  /** Binding label reported by `health()`. */
  binding?: string;
}

/** The assembled state of one backend, shared with the engine assembly. */
export interface StorageBackendState {
  keys: EventsKeys;
  engineKeys: EngineKeys;
  sealer: Sealer;
  log: EventLog;
  cursorKey: Uint8Array;
  layout: number;
}

/** A backend plus a way to reach its assembled state and job context. */
export interface StorageEventsBackend extends EventsBackend {
  /** Lazily initialised keys, sealer, log and meta. */
  state(): Promise<StorageBackendState>;
  /** The job engine context for `deps`. */
  engineContext(deps: ProcessDeps): Promise<EngineContext>;
}

/**
 * Engine-side key builder over the namespace root. Partition indexes use the
 * raw partition value here because the engine's key seam is synchronous.
 */
function engineKeysOf(k: EventsKeys): EngineKeys {
  const root = k.root;
  return {
    job: (id) => k.job(id),
    due: () => k.due(),
    dead: (id) => k.dead(id),
    deadIdx: () => k.deadIndex(),
    inflight: (id) => k.inflight(id),
    attempts: (id) => k.attempts(id),
    sub: (id) => k.sub(id),
    status: (id) => k.status(id),
    tomb: (id) => k.tomb(id),
    cb: (host) => k.breaker(host),
    log: (n) => k.log(n),
    fanout: (n) => k.fanout(n),
    fanoutDue: () => k.fanoutDue(),
    lockFanout: (n) => k.lockFanout(n),
    byName: (n) => k.byName(n),
    // TODO(events): hash partition values like EventsKeys.byNamePartition once the engine key seam is async.
    byNamePartition: (n, p) => `${k.byName(n)}:p:${encodeURIComponent(p)}`,
    byNamePartitioned: (n) => `${k.byName(n)}:p:*`,
    verified: (p, u) => `${root}verified:${encodeURIComponent(`${p}|${u}`)}`,
    verifyFail: (p, u) =>
      `${root}verifyfail:${encodeURIComponent(`${p}|${u}`)}`,
    rlVerifyPrincipal: (p, h, m) => k.rlVerifyPrincipal(p, h, m),
    rlVerifyHost: (h, m) => k.rlVerifyHost(h, m),
    inflightVerify: (h) => k.inflightVerify(h),
  };
}

/**
 * Deterministic subscription id for `(principal, url, name, args)` (D6).
 *
 * @param key - The subscription identity.
 * @returns `sub_` plus 32 hex characters.
 */
export async function subscriptionIdOf(key: SubscriptionKey): Promise<string> {
  const h = await digest(
    canonicalJson([key.principal, key.url, key.name, key.args])
  );
  return `sub_${h.slice(0, 32)}`;
}

function viewOf(sub: SubscriptionRecord): SubscriptionView {
  return {
    id: sub.id,
    name: sub.name,
    args: sub.args,
    principal: sub.principal,
    mode: "webhook",
    url: sub.url,
    dialect: sub.profile.preset,
    createdAt: new Date(sub.createdAt).toISOString(),
    refreshedAt: new Date(sub.refreshedAt).toISOString(),
    expiresAt:
      sub.expiresAt === null ? null : new Date(sub.expiresAt).toISOString(),
    watermark: null,
  } as unknown as SubscriptionView;
}

/**
 * Create the backend.
 *
 * @param options - Storage, namespace, keyring and runtime facts.
 * @returns The backend; state initialises on first use.
 */
export function storageBackend(
  options: StorageBackendOptions
): StorageEventsBackend {
  const { storage, clock } = options;
  const config = defaultJobRuntimeConfig(options.jobs);
  let statePromise: Promise<StorageBackendState> | undefined;

  const state = (): Promise<StorageBackendState> =>
    (statePromise ??= (async () => {
      const keys = await createEventsKeys({
        namespace: options.namespace,
        ...(options.prefix !== undefined && { prefix: options.prefix }),
      });
      const sealer =
        options.unsealed === true || options.keyring.length === 0
          ? plaintextSealer()
          : createSealer(await createEventsKeyring(options.keyring));
      const meta = await ensureMeta(storage, sealer, keys.meta(), clock);
      // Log entries are sealed with the binding's sealer (plaintext only when
      // unsealed); the job engine opens them through `openLog`.
      const log = createEventLog({ storage, keys, sealer });
      return {
        keys,
        engineKeys: engineKeysOf(keys),
        sealer,
        log,
        cursorKey: meta.cursorKey,
        layout: meta.layout,
      };
    })());

  const ctxFor = async (deps: ProcessDeps): Promise<EngineContext> => {
    const s = await state();
    return {
      storage,
      keys: s.engineKeys,
      codec: jsonCodec,
      clock: deps.clock,
      registry: deps.registry,
      send: deps.send,
      log: deps.log,
      owner: deps.owner,
      config,
      cursor: async (name, epoch, seq) => {
        const { encodeCursor } = await import("./engine/cursor.js");
        return encodeCursor(s.cursorKey, name, epoch, seq);
      },
      ...(s.sealer.sealed && {
        openLog: (key: string, raw: string) => s.sealer.open(key, raw),
      }),
    };
  };

  const readSub = async (id: string): Promise<SubscriptionRecord | null> => {
    const s = await state();
    const got = await storage.read(s.keys.sub(id));
    return got ? (JSON.parse(got.value) as SubscriptionRecord) : null;
  };

  const removeSub = async (sub: SubscriptionRecord): Promise<void> => {
    const s = await state();
    await storage.remove(s.keys.sub(sub.id));
    await storage.indexRemove(s.engineKeys.byName(sub.name), sub.id);
    if (sub.partition !== null) {
      await storage.indexRemove(
        s.engineKeys.byNamePartition(sub.name, sub.partition),
        sub.id
      );
      await storage.indexRemove(
        s.engineKeys.byNamePartitioned(sub.name),
        sub.id
      );
    }
    await storage.indexRemove(s.keys.expiry(), sub.id);
    await storage.set(
      s.keys.tomb(sub.id),
      JSON.stringify({ reason: "removed" }),
      config.retryMaxAgeMs
    );
  };

  const allSubs = async (name?: string): Promise<SubscriptionRecord[]> => {
    const s = await state();
    const out: SubscriptionRecord[] = [];
    const names = name !== undefined ? [name] : await knownNames();
    for (const n of names) {
      let after: string | undefined;
      do {
        const page = await storage.indexRange(s.engineKeys.byName(n), {
          limit: 200,
          ...(after !== undefined && { after }),
        });
        for (const { member } of page.items) {
          const sub = await readSub(member);
          if (sub) out.push(sub);
        }
        after = page.next;
      } while (after !== undefined);
    }
    return out;
  };

  const knownNames = async (): Promise<string[]> => {
    const s = await state();
    const got = await storage.get(`${s.keys.root}names`);
    return got ? (JSON.parse(got) as string[]) : [];
  };

  const rememberName = async (name: string): Promise<void> => {
    const s = await state();
    const names = await knownNames();
    if (!names.includes(name)) {
      names.push(name);
      await storage.write(`${s.keys.root}names`, JSON.stringify(names));
    }
  };

  const backend: StorageEventsBackend = {
    kind: `storage:${storage.kind}`,
    capabilities: {
      durable: options.durable,
      shared: options.shared,
      maxTtlMs: 30 * 86_400_000,
      allowNoExpiry: true,
      maxPayloadBytes: 256 * 1024,
      signal: storage.signal !== undefined,
      tail: "shared",
    },
    state,
    engineContext: ctxFor,

    async meta() {
      const s = await state();
      return { layout: s.layout, cursorKey: s.cursorKey };
    },

    async append(items: readonly AppendItem[]) {
      const s = await state();
      const out = [];
      for (const item of items) {
        const r = await s.log.append(item.name, item.value, {
          maxEvents: 10_000,
          ...(item.dedupeKey !== null && {
            dedupe: {
              key: s.keys.emitDedupe(item.name, item.dedupeKey),
              ttlMs: 86_400_000,
            },
          }),
          markFanout: true,
          notify: true,
          now: clock.now(),
        });
        out.push(r);
      }
      return out;
    },

    async readLog(name, after, o) {
      const s = await state();
      const r = await s.log.range(name, after, o.limit);
      return {
        entries: r.entries,
        epoch: r.epoch,
        first: r.first,
        head: r.head,
      };
    },

    async trimLog(name, before) {
      const s = await state();
      return s.log.trim(name, before);
    },

    async subscribe(input, ctx): Promise<SubscriptionGrant> {
      const s = await state();
      const id = await subscriptionIdOf(input.key);
      const existing = await readSub(id);
      const now = ctx.now;
      const expiresAt =
        input.grantTtlMs === null ? null : now + input.grantTtlMs;
      let start = existing?.start ?? null;
      let truncated = false;
      if (existing === null) {
        const bounds = await s.log.range(input.key.name, null, 0);
        const resolved = await resolveCursor({
          cursorKey: s.cursorKey,
          name: input.key.name,
          cursor: input.cursor,
          bounds: {
            epoch: bounds.epoch,
            first: bounds.first,
            head: bounds.head,
          },
          replayable: input.cursor !== null,
          ...(input.maxAgeMs !== undefined && { maxAgeMs: input.maxAgeMs }),
          now,
        });
        truncated = resolved.truncated;
        start = {
          epoch: resolved.epoch ?? "",
          seq: resolved.seq,
        };
      }
      const record: SubscriptionRecord = {
        v: 1,
        id,
        principal: input.key.principal,
        name: input.key.name,
        args: input.key.args,
        argsHash: await digest(canonicalJson(input.key.args)),
        partition: input.partition,
        url: input.key.url,
        secret: input.secret,
        ...(existing !== null &&
          existing.secret !== input.secret && {
            previousSecret: {
              secret: existing.secret,
              expiresAt: now + config.rotationGraceMs,
            },
          }),
        profile: input.profile,
        createdAt: existing?.createdAt ?? now,
        refreshedAt: now,
        expiresAt,
        verifiedVia: existing?.verifiedVia ?? "challenge",
        catalogHash: existing?.catalogHash ?? "",
        start,
        meta: input.meta,
      };
      await storage.write(s.keys.sub(id), JSON.stringify(record));
      await storage.remove(s.keys.tomb(id));
      if (expiresAt !== null)
        await storage.indexAdd(s.keys.expiry(), id, expiresAt);
      await rememberName(record.name);
      const ectx = await ctxFor({
        registry: {
          size: 0,
          get: () => undefined,
          all: () => [],
          catalogHash: "",
        },
        clock,
        send: async () => {
          throw new Error("unused");
        },
        log: () => undefined,
        owner: "subscribe",
      });
      await indexSubscription(ectx, record);
      const cursor =
        start !== null && start.epoch !== ""
          ? await (
              await import("./engine/cursor.js")
            ).encodeCursor(s.cursorKey, record.name, start.epoch, start.seq)
          : null;
      return {
        id,
        created: existing === null,
        refreshBefore:
          expiresAt === null
            ? null
            : new Date(now + Math.floor((expiresAt - now) * 0.8)).toISOString(),
        cursor,
        truncated,
        ...(existing !== null && {
          deliveryStatus: {
            active: true,
            lastDeliveryAt: null,
            lastError: null,
          },
        }),
      };
    },

    async unsubscribe(key) {
      const id = await subscriptionIdOf(key);
      const sub = await readSub(id);
      if (sub === null) return { removed: null };
      await removeSub(sub);
      return { removed: viewOf(sub) };
    },

    async revoke(filter) {
      const subs =
        filter.subscriptionId !== undefined
          ? [await readSub(filter.subscriptionId)].filter(
              (x): x is SubscriptionRecord => x !== null
            )
          : await allSubs(filter.name);
      const removed: SubscriptionView[] = [];
      for (const sub of subs) {
        if (filter.principal !== undefined && filter.principal !== "*") {
          if (sub.principal !== filter.principal) continue;
        }
        if (filter.name !== undefined && sub.name !== filter.name) continue;
        await removeSub(sub);
        removed.push(viewOf(sub));
      }
      return { removed };
    },

    async isRevoked(key) {
      const s = await state();
      const id = await subscriptionIdOf(key);
      return (await storage.get(s.keys.tomb(id))) !== undefined;
    },

    async watermark() {
      // TODO(events): derive from fanout state and inflight jobs (WP-15 watermark.ts).
      return null;
    },

    async claimFanout(name) {
      const s = await state();
      const got = await storage.read(s.keys.fanout(name));
      const st: FanoutState = got
        ? (JSON.parse(got.value) as FanoutState)
        : { v: 1, epoch: null, through: 0, updatedAt: clock.now() };
      return { state: st, version: got?.version ?? "" };
    },

    async commitFanout(name, st, version) {
      const s = await state();
      const ok = await storage.write(s.keys.fanout(name), JSON.stringify(st), {
        ifVersion: version === "" ? null : version,
      });
      return ok !== false;
    },

    async find(q) {
      const ectx = await ctxFor({
        registry: {
          size: 0,
          get: () => undefined,
          all: () => [],
          catalogHash: "",
        },
        clock,
        send: async () => {
          throw new Error("unused");
        },
        log: () => undefined,
        owner: "find",
      });
      return pageSubscriptions(ectx, q.name, q.group, {
        after: q.after,
        limit: q.limit,
      });
    },

    async createDeliveries() {
      // The dispatcher (WP-15) creates deliver jobs directly through the job
      // engine; this boundary method is kept for alternative backends.
    },

    async touchLease(input) {
      const s = await state();
      const now = clock.now();
      const key = s.keys.lease(input.id);
      const got = await storage.read(key);
      const prev = got ? (JSON.parse(got.value) as DirectLease) : undefined;
      const lease: DirectLease = {
        v: 1,
        id: input.id,
        name: input.name,
        principal: input.principal,
        args: input.args,
        modes: [
          ...new Set([...(prev?.modes ?? []), input.mode]),
        ] as DirectLease["modes"],
        createdAt: prev?.createdAt ?? now,
        touchedAt: now,
        expiresAt: now + input.ttlMs,
      };
      await storage.write(key, JSON.stringify(lease), { ttlMs: input.ttlMs });
      await storage.indexAdd(s.keys.leaseExpiry(), input.id, lease.expiresAt);
      return { created: prev === undefined, lease };
    },

    async expiredLeases(limit) {
      const s = await state();
      const page = await storage.indexRange(s.keys.leaseExpiry(), {
        max: clock.now(),
        limit,
      });
      const out: DirectLease[] = [];
      for (const { member } of page.items) {
        await storage.indexRemove(s.keys.leaseExpiry(), member);
        out.push({
          v: 1,
          id: member,
          name: "",
          principal: "",
          args: {},
          modes: [],
          createdAt: 0,
          touchedAt: 0,
          expiresAt: 0,
        });
      }
      return out;
    },

    async process(ref, deps, o) {
      const ectx = await ctxFor(deps);
      if (ref === "due") {
        return processDue(ectx, {
          ...(o?.kinds !== undefined && { kinds: o.kinds }),
          ...(o?.budgetMs !== undefined && { budgetMs: o.budgetMs }),
        });
      }
      const ran = await processJob(ectx, ref.jobId, o?.kinds);
      return {
        attempted: ran ? 1 : 0,
        expired: 0,
        remaining: 0,
        nextWakeAt: await nextWakeAt(ectx),
      };
    },

    async sweep() {
      const s = await state();
      const page = await storage.indexRange(s.keys.expiry(), {
        max: clock.now(),
        limit: 200,
      });
      let expired = 0;
      for (const { member } of page.items) {
        const sub = await readSub(member);
        await storage.indexRemove(s.keys.expiry(), member);
        if (sub !== null) {
          await removeSub(sub);
          expired++;
        }
      }
      return { expired };
    },

    async health(): Promise<EventsHealth> {
      const s = await state();
      const now = clock.now();
      const due = await storage.indexCount(s.keys.due(), { max: now });
      const first = await storage.indexRange(s.keys.due(), { limit: 1 });
      const fanout = await storage.indexRange(s.keys.fanoutDue(), {
        limit: 1,
      });
      const scores = [first.items[0]?.score, fanout.items[0]?.score].filter(
        (x): x is number => x !== undefined
      );
      const subs = await allSubs();
      return {
        state: "ready",
        binding: options.binding ?? "user",
        kind: storage.kind,
        layout: s.layout === 1 ? 1 : null,
        durable: options.durable,
        shared: options.shared,
        nsHash: s.keys.ns16,
        due,
        oldestDueAgeMs:
          first.items[0] !== undefined && first.items[0].score <= now
            ? now - first.items[0].score
            : null,
        nextWakeAt: scores.length
          ? new Date(Math.min(...scores)).toISOString()
          : null,
        deadLetters: await storage.indexCount(s.keys.deadIndex(), {}),
        subscriptions: subs.length,
        suspended: 0,
        neverRefreshed: subs.filter((x) => x.refreshedAt === x.createdAt)
          .length,
        circuitOpenHosts: 0,
        sender: "node-pinned",
        sdk: {} as EventsHealth["sdk"],
        build: { sha: "" },
        ticks: { count: 0, last: null },
        sweeper: { leader: true, instance: "" },
      };
    },

    async close() {
      // The binding owns the store's lifecycle; nothing to release here.
    },
  };
  return backend;
}
