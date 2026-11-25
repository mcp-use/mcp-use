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
import { resolveKnobs } from "../env.js";

/** Reserved epoch for cursors handed out before a log has any entry. */
const EMPTY_EPOCH = "000000000000";

/** Inputs of {@link assembleEventsEngine}. */
export interface AssembleInput {
  options: EventsHostOptions;
  registry: EventsRegistry;
  mode: EventsStartMode;
  /** Effective modes of an event (shared with `events/list`). */
  modesFor(event: RegisteredEvent): DeliveryMode[];
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
  const pollIntervalMs = resolveKnobs(env, {}).pollIntervalMs.value;
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

  // eslint-disable-next-line prefer-const -- assigned after the handlers that kick it are defined
  let pump: Pump | undefined;

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
          pump?.kick();
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
        default:
          // TODO(events): events/stream needs the shared LogTail and StreamRegistry wiring.
          throw new EventsError(
            "methodNotFound" as never,
            "events/stream is not assembled yet"
          );
      }
    },
  };

  const handleRequest = (req: ResponderRequest) =>
    handleSubscribeEtc.handle(req);

  const emit = async (
    name: string,
    data: unknown,
    o?: EmitOptions
  ): Promise<EmitResult> => {
    const ev = registry.get(name);
    const entry = buildEventEntry(
      {
        name,
        data,
        partition: null,
        ...(o as Record<string, unknown> | undefined),
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
    pump?.kick();
    return { eventId: r.eventId, duplicate: r.duplicate, accepted: true };
  };

  const work = () => backend.process("due", deps, { budgetMs: 25_000 });
  // TODO(events): handler hosts on serverless runtimes should use the WP-24
  // lazy pump with waitUntil and tick routes; an unref'd pump serves
  // long-lived handler hosts such as `mcp-use dev`.
  pump = startPump({
    work,
    scanMs: 1_000,
    idleMs: 5_000,
    unref: input.mode !== "listen",
    onError: (e) => console.warn("events: pump error", e),
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
    async close() {
      await pump?.stop();
      await backend.close(5_000);
    },
  };
}
