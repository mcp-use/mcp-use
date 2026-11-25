/**
 * Engine assembly (WP-20): resolves the store binding, builds the storage
 * backend, the responder engine (subscribe, unsubscribe, poll, stream), the
 * storage-backed `server.events` methods and the work pump. Loaded with a
 * dynamic import from the host so zero-event servers never pay for it.
 *
 * @internal
 */

import { EventsError } from "@mcp-use/events-core";
import type { EventsHostOptions, EventsStartMode } from "../internal/host.js";
import { systemClock } from "../internal/clock.js";
import type { ProcessDeps } from "../internal/backend.js";
import type { SubscriptionRecord } from "../internal/records.js";
import type { EventsRegistry, RegisteredEvent } from "../internal/registry.js";
import type { EventsRuntimeParts } from "../server-events.js";
import type {
  ResponderEngine,
  ResponderOutcome,
  ResponderRequest,
} from "../responder/index.js";
import { resolveStoreBinding } from "../binding/resolve.js";
import { activeEventsDev } from "../dev/index.js";
import { storageBackend } from "../storage-backend.js";
import { startPump, type Pump } from "../drivers/pump.js";
import { nodeWebhookSender } from "../senders/node.js";
import { wireErrorCategory } from "../senders/types.js";
import type { DeliveryMode, EmitOptions, EmitResult } from "../types.js";
import { decodeCursor, encodeCursor, resolveCursor } from "./cursor.js";
import { appendEvent, buildEventEntry } from "./emit.js";
import { handlePoll, type CursorCodec } from "./poll.js";
import { createRateLimiter } from "./quotas.js";
import { pinProfile, resolveRequestProfile } from "./profile.js";
import { resolvePrincipal } from "./principal.js";
import { projectSignals } from "./signals.js";
import { handleSubscribe } from "./subscribe.js";
import { handleUnsubscribe } from "./unsubscribe.js";
import { validateArguments } from "./validate.js";
import { createVerifier } from "./verify/index.js";
import { revoke as revokeSubscriptions } from "./revoke.js";
import { readEventsEnv, resolveKnobs } from "../env.js";
import { EVENTS_DEFAULTS } from "../config.js";
import { parseDurationMs } from "../registry.js";
import { LogTail } from "../responder/logtail.js";
import { StreamRegistry, handleStream } from "../responder/stream.js";
import { createEventsRouter } from "../routes/index.js";
import type { RouteAuthConfig } from "../routes/auth.js";
import { runDecommission } from "../routes/decommission.js";
import { openEventsAdminWith } from "../admin/open.js";
import { plainCodec } from "../admin/views.js";
import { adminKeys } from "../admin/status.js";
import { createLazyPump, type LazyPump } from "../drivers/lazy-pump.js";
import { hasServerlessMarker, isWorkersRuntime } from "../drivers/markers.js";
import { runScheduled } from "../drivers/scheduled.js";
import { runTick, type TickCounters } from "../drivers/tick.js";
import {
  executionCtxWaitUntil,
  resolveWaitUntil,
  runInBackground,
  type WaitUntil,
} from "../drivers/wait-until.js";
import { controlEntry } from "./control.js";

/** Reserved epoch for cursors handed out before a log has any entry. */
const EMPTY_EPOCH = "000000000000";

/** Inputs of {@link assembleEventsEngine}. */
export interface AssembleInput {
  options: EventsHostOptions;
  registry: EventsRegistry;
  mode: EventsStartMode;
  /** Effective modes of an event (shared with `events/list`). */
  modesFor(event: RegisteredEvent): DeliveryMode[];
  /** `events.waitUntil` or the runtime one threaded through `server.fetch`. */
  waitUntil?: () => WaitUntil | undefined;
}

/** Split a secret option (string list or comma list) into bearers. */
function secretList(v: string | readonly string[] | undefined): string[] {
  if (v === undefined) return [];
  const all = typeof v === "string" ? v.split(",") : [...v];
  return all.map((x) => x.trim()).filter((x) => x !== "");
}

/**
 * Resolve the binding and assemble the engine runtime parts.
 *
 * @param input - Host options, registry and start mode.
 * @returns The parts the host binds; empty when the binding is inert or unconfigured.
 */
export async function assembleEventsEngine(
  input: AssembleInput
): Promise<EventsRuntimeParts> {
  const { options, registry } = input;
  const config = options.config;
  const env =
    (globalThis as { process?: { env?: Record<string, string> } }).process
      ?.env ?? {};
  const dev = activeEventsDev();
  const binding = await resolveStoreBinding({
    env,
    ...(config?.storage !== undefined && { eventsStorage: config.storage }),
    ...(options.storage !== undefined && { serverStorage: options.storage }),
    ...(config?.namespace !== undefined && { namespace: config.namespace }),
    ...(config?.secret !== undefined && { secret: config.secret }),
    ...(dev !== undefined && {
      devRuntime: {
        stateDir: dev.stateDir,
        workspace: dev.stateDir,
        token: dev.token,
      },
    }),
    loopbackListen: input.mode === "listen",
    basePath: options.basePath(),
    serverName: "mcp-use",
  });
  if (binding.state !== "active") {
    if (binding.state === "unconfigured")
      console.warn(`events: ${binding.reason}`);
    return {};
  }
  for (const w of binding.warnings) console.warn(w);

  const clock = systemClock;
  const backend = storageBackend({
    storage: binding.storage,
    namespace: binding.namespace,
    keyring: binding.keyring,
    unsealed: binding.unsealed,
    durable: binding.storage.durable,
    shared: binding.storage.shared,
    clock,
    binding: binding.kind,
  });
  const st = await backend.state();
  const sender = nodeWebhookSender();
  const owner = `inst_${Math.random().toString(36).slice(2, 10)}`;
  const deps: ProcessDeps = {
    registry,
    clock,
    send: async (r) => {
      const started = clock.now();
      const signal = r.signal ?? AbortSignal.timeout(r.timeoutMs);
      const trusted =
        dev !== undefined && r.url.startsWith(dev.trustedCallbackPrefix());
      const out = await sender({
        url: r.url,
        headers: r.headers,
        body: r.body,
        trusted,
        signal,
      });
      const ms = clock.now() - started;
      if ("error" in out) {
        return { ok: false, error: wireErrorCategory(out.error), ms };
      }
      return {
        ok: true,
        status: out.status,
        headers:
          out.retryAfterMs !== undefined
            ? { "retry-after": String(Math.ceil(out.retryAfterMs / 1000)) }
            : {},
        body: out.body,
        ms,
      };
    },
    log: (r) => {
      if (env["MCP_USE_EVENTS_DEBUG"]) console.log(JSON.stringify(r));
    },
    owner,
  };
  const ectx = await backend.engineContext(deps);
  const verifier = createVerifier(ectx);
  const knobs = resolveKnobs(env, {});
  const pollIntervalMs = knobs.pollIntervalMs.value;
  const heartbeatMaxMs = knobs.heartbeatMaxMs.value;
  const snapshot = readEventsEnv(env);
  const serverless = hasServerlessMarker(snapshot);
  // push.maxDuration: code, then env, then the runtime default (§8.19); 0 = unlimited.
  const maxDurationMs = ((): number => {
    const code = config?.push?.maxDuration;
    if (code === null) return 0;
    const parsed = parseDurationMs(code ?? undefined);
    if (parsed !== undefined) return parsed;
    const k = knobs.pushMaxDurationMs.value;
    if (k === null) return 0;
    if (k !== undefined) return k;
    if (isWorkersRuntime()) return EVENTS_DEFAULTS.pushMaxDurationWorkersMs;
    if (serverless) return EVENTS_DEFAULTS.pushMaxDurationServerlessMs;
    return EVENTS_DEFAULTS.pushMaxDurationLongLivedMs;
  })();
  // One shared tail per process fans new log entries out to open streams.
  const tailMs = parseDurationMs(config?.push?.tailInterval);
  const tail = new LogTail({
    backend,
    clock,
    ...(tailMs !== undefined && { intervalMs: tailMs }),
  });
  const streams = new StreamRegistry();
  const rate = createRateLimiter(120);

  const codec: CursorCodec = {
    // An empty log has no epoch yet: its cursor uses the reserved epoch
    // EMPTY_EPOCH and means "before the first entry of whatever epoch comes".
    encode: async (name, epoch, seq) =>
      encodeCursor(st.cursorKey, name, epoch ?? EMPTY_EPOCH, seq),
    async resolve(name, cursor, o) {
      const page = await backend.readLog(name, null, { limit: 0 });
      const decoded = await decodeCursor(st.cursorKey, name, cursor);
      if (decoded?.epoch === EMPTY_EPOCH && decoded.seq === 0) {
        return {
          epoch: page.epoch,
          seq: page.epoch === null ? 0 : page.first - 1,
          reset: false,
          floor: null,
        };
      }
      const r = await resolveCursor({
        cursorKey: st.cursorKey,
        name,
        cursor,
        bounds: { epoch: page.epoch, first: page.first, head: page.head },
        replayable: true,
        ...(o.maxAgeMs !== undefined && { maxAgeMs: o.maxAgeMs }),
        now: o.now,
      });
      return {
        epoch: r.epoch,
        seq: r.seq,
        reset: decoded === undefined || r.truncated,
        floor: o.maxAgeMs !== undefined ? o.now - o.maxAgeMs : null,
      };
    },
  };

  let kick: (w?: WaitUntil) => void = () => {};

  const common = (req: ResponderRequest, mode: "webhook" | "poll" | "push") => {
    const profile = resolveRequestProfile(
      req.signals,
      config?.compatibility,
      req.method
    );
    const viaTunnel = dev?.isTunnelRequest(req.request) ?? false;
    const auth = (req.request as unknown as { auth?: { principal?: string } })
      .auth;
    const resolve = () =>
      resolvePrincipal({
        ...(auth !== undefined && { auth }),
        oauthConfigured: options.oauth,
        devRuntime: dev !== undefined,
        viaTunnel,
        ...(config?.anonymous !== undefined && {
          anonymous: config.anonymous as "auto" | "reject" | "openai",
        }),
        mode,
        preset: profile.preset,
      });
    const envModes = {
      webhookPrincipalSource: options.oauth || dev !== undefined,
      pollEnabled: config?.poll?.enabled !== false,
      pushEnabled: config?.push?.enabled !== false,
    };
    // TODO(events): pass the real request context (WP-21) to authorize/visible/onSubscribe.
    const reqCtx = {} as never;
    return {
      profile,
      resolve,
      viaTunnel,
      shared: {
        registry,
        env: envModes,
        isDormant: () => false,
        isVisible: async (ev: RegisteredEvent) => {
          const v = ev.definition.visible;
          return typeof v === "function" ? Boolean(await v(reqCtx)) : true;
        },
        validateArgs: (ev: RegisteredEvent, args: Record<string, unknown>) =>
          validateArguments(
            ev.definition.inputSchema as Parameters<
              typeof validateArguments
            >[0],
            args
          ),
        principal: () => {
          try {
            return resolve().principal;
          } catch {
            return null;
          }
        },
        authorize: async (
          ev: RegisteredEvent,
          args: Record<string, unknown>
        ) => {
          const a = ev.definition.authorize;
          return typeof a === "function"
            ? Boolean(await a(args as never, reqCtx))
            : true;
        },
        isClosed: async () =>
          (await binding.storage.get(st.keys.closed())) !== undefined,
        onSubscribe: async (ev: RegisteredEvent, info: unknown) => {
          const h = ev.definition.onSubscribe;
          if (typeof h === "function") await h(info as never, reqCtx);
        },
      },
    };
  };

  const total = async () => (await backend.health()).subscriptions;

  const responder: ResponderEngine = {
    async handle(req) {
      try {
        return await handleRequest(req);
      } catch (err) {
        if (!(err instanceof EventsError) && !(err as { code?: unknown })?.code)
          console.error(`events: ${req.method} failed`, err);
        throw err;
      }
    },
  };

  const handleSubscribeEtc = {
    async handle(req: ResponderRequest): Promise<ResponderOutcome> {
      const params = req.params;
      switch (req.method) {
        case "events/subscribe": {
          const c = common(req, "webhook");
          const r = c.resolve();
          const pin = pinProfile(c.profile);
          const result = await handleSubscribe(params, {
            ...c.shared,
            backend,
            now: () => clock.now(),
            axes: c.profile.axes,
            profile: pin as never,
            meta: projectSignals(req.signals, {
              anonymous: r.anonymous,
              dev: r.dev,
            }),
            tunnelRequest: c.viaTunnel,
            trustedOrigin: (origin) => {
              if (dev === undefined || c.viaTunnel) return false;
              try {
                return new URL(dev.trustedCallbackPrefix()).origin === origin;
              } catch {
                return false;
              }
            },
            findRecord: async (id) => {
              const got = await binding.storage.read(st.keys.sub(id));
              return got ? (JSON.parse(got.value) as SubscriptionRecord) : null;
            },
            // TODO(events): per-principal and anonymous counts need by-principal
            // indexes; until then every count is the namespace total (conservative).
            quotaCounts: {
              all: total,
              byPrincipal: total,
              anonymousByUrl: total,
              anonymous: total,
            },
            verify: async (url, principal, secret) => {
              if (
                dev !== undefined &&
                !c.viaTunnel &&
                url.startsWith(dev.trustedCallbackPrefix())
              )
                return;
              const v = await verifier.verify({
                url,
                secret,
                principal,
                subscriptionId: "pending",
                axes: c.profile.axes,
                viaTunnel: c.viaTunnel,
              });
              if (!v.ok)
                throw new EventsError(
                  "callbackEndpointError",
                  "Callback verification failed",
                  {
                    reason: v.reason,
                  }
                );
            },
          });
          kick();
          return {
            result: result as unknown as Record<string, unknown>,
            dialect: c.profile.preset,
          };
        }
        case "events/unsubscribe": {
          const c = common(req, "webhook");
          const result = await handleUnsubscribe(params, {
            backend,
            axes: c.profile.axes,
            principal: c.shared.principal,
            now: () => clock.now(),
          } as never);
          return {
            result: result as Record<string, unknown>,
            dialect: c.profile.preset,
          };
        }
        case "events/poll": {
          const c = common(req, "poll");
          const result = await handlePoll(params, {
            ...c.shared,
            backend,
            codec,
            era: req.era === "legacy" ? "legacy" : "modern",
            listedModes: c.profile.axes.listedModes,
            now: () => clock.now(),
            pollIntervalMs,
            rate,
          });
          return {
            result: result as unknown as Record<string, unknown>,
            dialect: c.profile.preset,
          };
        }
        case "events/stream": {
          const c = common(req, "push");
          const response = await handleStream(
            (req.id ?? 0) as string | number,
            params,
            {
              ...c.shared,
              backend,
              codec,
              era: req.era === "legacy" ? "legacy" : "modern",
              listedModes: c.profile.axes.listedModes,
              tail,
              clock,
              streams,
              heartbeatMaxMs,
              maxDurationMs,
              pollIntervalMs,
              ...(config?.push?.maxBacklogBytes !== undefined && {
                maxBacklogBytes: config.push.maxBacklogBytes,
              }),
              toJsonRpc: (e) => e.toJsonRpc({ errorCodes: "sep" }),
            },
            req.request.signal
          );
          return { response };
        }
        default:
          throw new EventsError(
            "notFound" as never,
            `Unknown method ${String(req.method)}`
          );
      }
    },
  };

  const handleRequest = (req: ResponderRequest) =>
    handleSubscribeEtc.handle(req);

  const emit = async (
    name: string,
    data: unknown,
    o?: EmitOptions & { test?: boolean }
  ): Promise<EmitResult> => {
    const ev = registry.get(name);
    const { ctx: emitCtx, onError: _onError, _meta, ...rest } = o ?? {};
    void _onError;
    const entry = buildEventEntry(
      {
        name,
        data,
        partition: null,
        ...rest,
        ...(_meta !== undefined && { meta: _meta }),
      } as never,
      clock
    );
    const r = await appendEvent(
      { log: st.log, keys: st.keys, clock },
      name,
      entry,
      {
        maxEvents: Math.max(ev?.replay ? ev.replay.maxEvents : 0, 10_000),
        webhook: true,
        notify: true,
      }
    );
    tail.signal();
    kick(executionCtxWaitUntil(emitCtx));
    return { eventId: r.eventId, duplicate: r.duplicate, accepted: true };
  };

  const work = () => backend.process("due", deps, { budgetMs: 25_000 });
  const ticks: TickCounters = { count: 0, last: null };
  const tick = () => runTick({ process: () => work() as never }, ticks);

  // Drivers (D19): `listen()` runs a pump; long-lived handler hosts a lazy,
  // unref'd pump; serverless hosts run work under `waitUntil` after each
  // emit or subscribe and rely on the tick route or `scheduled` otherwise.
  const workerOff = config?.worker === "off";
  let pump: Pump | undefined;
  let lazy: LazyPump | undefined;
  const pumpOptions = {
    work,
    scanMs: 1_000,
    idleMs: 5_000,
    onError: (e: unknown) => console.warn("events: pump error", e),
  };
  if (!workerOff && input.mode === "listen") {
    pump = startPump({ ...pumpOptions, unref: false });
  } else if (!workerOff) {
    lazy = createLazyPump(pumpOptions, !serverless);
    lazy.touch();
  }
  kick = (w) => {
    if (pump !== undefined) return pump.kick();
    const waitUntil = resolveWaitUntil(w, input.waitUntil?.());
    if (lazy?.pump === undefined && waitUntil !== undefined && !workerOff) {
      runInBackground(waitUntil, work(), (e) =>
        console.warn("events: background work failed", e)
      );
      return;
    }
    lazy?.touch();
  };

  // Internal routes (D41): admin secrets, tick secret, dev token.
  const routeAuth: RouteAuthConfig = {
    tick:
      config?.tick?.secret !== undefined
        ? secretList(config.tick.secret)
        : (snapshot.tickSecrets ?? []),
    admin: [
      ...(config?.admin?.secret !== undefined
        ? secretList(config.admin.secret)
        : (snapshot.adminSecrets.user ?? [])),
      ...(snapshot.adminSecrets.platform ?? []),
    ],
    ...(dev !== undefined && { devToken: dev.token }),
  };
  const admin = openEventsAdminWith(
    { storage: binding.storage, namespace: binding.namespace },
    {
      codec: plainCodec,
      revoke: async (f) => ({
        removed: (await backend.revoke(f, { now: clock.now() })).removed.length,
      }),
      now: () => clock.now(),
    }
  );
  const route = createEventsRouter({
    basePath: () => options.basePath(),
    auth: () => routeAuth,
    tick,
    health: () => backend.health(),
    emit: async () => ({
      namespace: binding.namespace,
      nsHash: binding.nsHash,
      dev: dev !== undefined,
      emit: async (r) => {
        const ev = registry.get(r.name);
        if (ev === undefined)
          throw new EventsError("notFound", `Unknown event "${r.name}"`, {
            kind: "event",
          });
        const valid = await ev.validatePayload(r.data);
        return emit(r.name, valid, {
          eventId: r.eventId,
          test: true,
          ...(r.principal !== undefined && { principal: r.principal }),
          ...(r.subscriptionId !== undefined && {
            subscriptionId: r.subscriptionId,
          }),
        });
      },
    }),
    admin: async () => admin,
    streams: async () => [],
    decommission: async (body) => {
      const out = await runDecommission(
        binding.storage,
        adminKeys(binding.nsHash),
        {
          revokeAll: async (reason) => ({
            terminated: (await backend.revoke({ reason }, { now: clock.now() }))
              .removed.length,
            hooks: 0,
          }),
          closeLogs: async () => {
            for (const ev of registry.all()) {
              await st.log.append(
                ev.name,
                controlEntry(
                  { all: true },
                  {
                    kind: "forbidden",
                    message: "",
                    data: { reason: "closed" },
                  },
                  clock.now()
                ),
                { maxEvents: 10_000, notify: true, now: clock.now() }
              );
            }
            tail.signal();
          },
          drain: async (deadlineAt) => {
            const left = Math.max(0, deadlineAt - clock.now());
            const r = await backend.process("due", deps, { budgetMs: left });
            return {
              undelivered: (r as { remaining?: number }).remaining ?? 0,
            };
          },
        },
        body,
        () => clock.now()
      );
      streams.closeAll();
      return out;
    },
  });

  return {
    responder,
    events: {
      emit,
      revoke: async (filter) => {
        const r = await revokeSubscriptions(filter as never, {
          backend,
          registry,
          now: () => clock.now(),
        });
        return r.removed as never;
      },
      process: () => work() as never,
      health: () => backend.health(),
    },
    route,
    scheduled: (_env, ctx) => runScheduled(tick, ctx),
    async close() {
      streams.closeAll();
      tail.close();
      await pump?.stop();
      await lazy?.stop();
      await backend.close(5_000);
    },
  };
}
