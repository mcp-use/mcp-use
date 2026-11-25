/**
 * `EventsHost` implementation: registry, `server.events`, preflight and
 * responder wiring. Binding and drivers (WP-24) and internal routes (WP-26)
 * plug in through {@link EventsRuntimeParts}.
 *
 * @internal
 */

import { EventsError } from "@mcp-use/events-core";
import { EventsConfigError } from "./errors.js";
import type {
  EventsHost,
  EventsHostOptions,
  EventsStartMode,
} from "./internal/host.js";
import type { RegisteredEvent } from "./internal/registry.js";
import { activeEventsDev } from "./dev/index.js";
import { createEventsPreflight } from "./preflight.js";
import { createEventsRegistry } from "./registry.js";
import type { MutableEventsRegistry } from "./registry.js";
import { respond } from "./responder/index.js";
import type {
  ResponderEngine,
  ResponderMiddleware,
} from "./responder/index.js";
import { createSdkEventsAdapter } from "./sdk-adapter.js";
import type { SdkEventsAdapter } from "./sdk-adapter.js";
import type {
  AnyEventDefinition,
  AnyRequestContext,
  DeliveryMode,
  EmitOptions,
  EmitResult,
  EventRef,
  ServerEvents,
} from "./types.js";

/**
 * The engine-side runtime the host delegates to once bound (WP-20/WP-24).
 * Every member is optional so the host works before the engine lands.
 */
export interface EventsRuntimeParts {
  /** Answer subscribe, unsubscribe, poll and stream. */
  responder?: ResponderEngine;
  /** `server.events` methods that need storage. */
  events?: Partial<ServerEvents>;
  /** Internal routes under `{basePath}/_mcp-use/events/`. */
  route?(request: Request): Promise<Response | undefined>;
  /** One Workers cron tick. */
  scheduled?(
    env: unknown,
    ctx: { waitUntil(p: Promise<unknown>): void }
  ): Promise<void>;
  /** Stop drivers, drain streams, close the backend. */
  close?(): Promise<void>;
}

/** Hooks the host exposes to other WPs (binding, middleware). */
export interface EventsHostInternals {
  /** The registry. */
  readonly registry: MutableEventsRegistry;
  /** The SDK adapter. */
  readonly sdk: SdkEventsAdapter;
  /** Install the engine runtime (binding resolution, WP-24). */
  bind(parts: EventsRuntimeParts): void;
  /** Install the `mcp:events/*` middleware chain (WP-22). */
  setMiddleware(middleware: ResponderMiddleware | undefined): void;
  /** Install the starter that resolves the binding at `start()` (WP-24). */
  setStarter(
    starter: (mode: EventsStartMode) => Promise<EventsRuntimeParts>
  ): void;
}

function unavailable(what: string): never {
  // TODO(events): WP-24 binds the engine; until then storage-backed calls fail typed.
  throw new EventsConfigError(
    "EVENTS_BACKEND_UNAVAILABLE",
    `events: ${what} needs the Events engine, which is not bound yet.`,
    { operation: what }
  );
}

/**
 * Create the host. Called by `MCPServer` only on the first Events API call
 * (`server.event()`, `server.events`), so a zero-event server never reaches it.
 *
 * @param options - Server configuration facts.
 */
export function createEventsHost(
  options: EventsHostOptions,
  existingRegistry?: MutableEventsRegistry
): EventsHost & EventsHostInternals {
  const config = options.config;
  const registry = existingRegistry ?? createEventsRegistry({ config });
  let runtimeWaitUntil: ((p: Promise<unknown>) => void) | undefined;
  const sdk = createSdkEventsAdapter();
  let parts: EventsRuntimeParts = {};
  let middleware: ResponderMiddleware | undefined;
  let starter:
    | ((mode: EventsStartMode) => Promise<EventsRuntimeParts>)
    | undefined;
  const streams = new Set<ReadableStream<Uint8Array>>();
  let started: Promise<void> | undefined;

  /**
   * Resolve the binding and assemble the engine once. `listen()` starts it
   * eagerly; handler hosts (`server.fetch`, `mcp-use dev`) start it on the
   * first `events/*` request or storage-backed `server.events` call.
   */
  const ensureStarted = (mode: EventsStartMode): Promise<void> =>
    (started ??= (async () => {
      const report = sdk.probe();
      if (report.P2 === "fail") {
        throw new EventsConfigError(
          "EVENTS_SDK_CLASSIFIER_MISSING",
          "The installed MCP SDK does not export classifyInboundRequest, validateHostHeader and validateOriginHeader."
        );
      }
      const start =
        starter ??
        (async (m: EventsStartMode) => {
          // The engine chunk loads only when a server with events starts.
          const { assembleEventsEngine } = await import("./engine/assemble.js");
          return assembleEventsEngine({
            options,
            registry,
            mode: m,
            modesFor,
            waitUntil: () => config?.waitUntil ?? runtimeWaitUntil,
          });
        });
      parts = { ...parts, ...(await start(mode)) };
    })().catch((error: unknown) => {
      started = undefined;
      throw error;
    }));
  const lazyParts = async (): Promise<EventsRuntimeParts> => {
    await ensureStarted("handler");
    return parts;
  };

  const pushOn = config?.push?.enabled !== false;
  const pollOn = config?.poll?.enabled !== false;
  const modesFor = (event: RegisteredEvent): DeliveryMode[] => {
    const d = event.definition.delivery ?? {};
    const out: DeliveryMode[] = [];
    if (
      d.webhook !== false &&
      (options.oauth || activeEventsDev() !== undefined)
    )
      out.push("webhook");
    if (d.push !== false && pushOn) out.push("push");
    if (event.replay !== false && d.poll !== false && pollOn) out.push("poll");
    return out;
  };

  const preflight = createEventsPreflight({
    sdk,
    registry,
    mcpName: config?.compatibility?.mcpName,
    warn: (message) => console.warn(message),
    dispatch: (request) =>
      respond(
        {
          registry,
          sdk,
          engine: async () => (await lazyParts()).responder,
          modesFor,
          openaiWebhook: (e) =>
            e.definition.delivery?.webhook !== false &&
            (options.oauth || config?.anonymous !== undefined),
          visible: async (event) => {
            const visible = event.definition.visible;
            if (typeof visible !== "function") return true;
            // TODO(events): pass the per-request context once the responder
            // receives it from the mount (WP-21 principal wiring).
            return (await visible({} as AnyRequestContext as never)) as boolean;
          },
          middleware,
          trackStream: (response) => {
            if (response.body !== null) streams.add(response.body);
            return response;
          },
        },
        request
      ),
  });

  const emit = async (
    name: string,
    data: unknown,
    emitOptions?: EmitOptions
  ): Promise<EmitResult> => {
    const event = registry.get(name);
    if (event === undefined) {
      throw new EventsError("notFound", `Unknown event "${name}"`, {
        kind: "event",
      });
    }
    const valid = await event.validatePayload(data);
    const bound = await lazyParts();
    if (bound.events?.emit === undefined) return unavailable("emit");
    return bound.events.emit(name, valid, emitOptions);
  };

  const events: ServerEvents = {
    emit,
    principalOf(ctx: AnyRequestContext): string | undefined {
      const extra = (
        ctx as unknown as {
          auth?: { principal?: string };
        }
      ).auth;
      return parts.events?.principalOf?.(ctx) ?? extra?.principal;
    },
    revoke: async (filter) => {
      const fn = (await lazyParts()).events?.revoke;
      return fn !== undefined ? fn(filter) : unavailable("revoke");
    },
    list: async (query) => {
      const fn = (await lazyParts()).events?.list;
      return fn !== undefined ? fn(query) : unavailable("list");
    },
    count: async (query) => {
      const fn = (await lazyParts()).events?.count;
      return fn !== undefined ? fn(query) : unavailable("count");
    },
    streams: () => parts.events?.streams?.() ?? [],
    process: async (o) => {
      const fn = (await lazyParts()).events?.process;
      return fn !== undefined ? fn(o) : unavailable("process");
    },
    info: async () => {
      const fn = (await lazyParts()).events?.info;
      return fn !== undefined ? fn() : unavailable("info");
    },
    health: async () => {
      const fn = (await lazyParts()).events?.health;
      return fn !== undefined ? fn() : unavailable("health");
    },
  };

  return {
    registry,
    sdk,
    get size() {
      return registry.size;
    },
    register(definition: AnyEventDefinition) {
      const registered = registry.add(definition);
      const ref: EventRef<string, unknown, unknown> = {
        name: registered.name,
        emit: (data, o) => emit(registered.name, data, o),
        terminate: (target, error) => {
          // TODO(events): WP-20 control.ts implements targeted termination.
          void target;
          void error;
          return events.revoke({
            name: registered.name,
            ...(target.principal !== undefined && {
              principal: target.principal,
            }),
            ...(target.subscriptionId !== undefined && {
              subscriptionId: target.subscriptionId,
            }),
            reason: "terminated",
          });
        },
      };
      return ref;
    },
    events,
    preflight,
    async route(request) {
      await ensureStarted("handler");
      return parts.route?.(request);
    },
    async start(mode) {
      await ensureStarted(mode);
    },
    async scheduled(env, ctx) {
      await ensureStarted("handler");
      await parts.scheduled?.(env, ctx);
    },
    setWaitUntil(waitUntil) {
      runtimeWaitUntil = waitUntil;
    },
    async close() {
      for (const stream of streams) {
        await stream.cancel("shutdown").catch(() => undefined);
      }
      streams.clear();
      await parts.close?.();
    },
    bind(next) {
      parts = { ...parts, ...next };
    },
    setMiddleware(next) {
      middleware = next;
    },
    setStarter(next) {
      starter = next;
    },
  };
}
