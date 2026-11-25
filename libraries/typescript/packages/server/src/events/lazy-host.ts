/**
 * The static Events host `MCPServer` owns. It keeps only the registry (so
 * `server.event()` validates synchronously) and loads `server-events.ts`
 * (preflight, responder, SDK adapter) with a dynamic import on first use, so
 * the root entry stays inside its size budget (D28).
 *
 * @internal
 */

import type { EventsHost, EventsHostOptions } from "./internal/host.js";
import { createEventsRegistry } from "./registry.js";
import type {
  AnyEventDefinition,
  AnyRequestContext,
  EventRef,
  ServerEvents,
} from "./types.js";

type LoadedHost = Awaited<
  ReturnType<typeof import("./server-events.js").createEventsHost>
>;

/**
 * Create the lazy host.
 *
 * @param options - Server configuration facts.
 */
export function createLazyEventsHost(options: EventsHostOptions): EventsHost {
  const registry = createEventsRegistry({ config: options.config });
  let loaded: LoadedHost | undefined;
  let loading: Promise<LoadedHost> | undefined;
  let waitUntil: ((p: Promise<unknown>) => void) | undefined;

  const load = (): Promise<LoadedHost> =>
    (loading ??= import("./server-events.js").then((m) => {
      loaded = m.createEventsHost(options, registry);
      loaded.setWaitUntil(waitUntil);
      return loaded;
    }));

  const events: ServerEvents = {
    emit: async (name, data, o) => (await load()).events.emit(name, data, o),
    principalOf(ctx: AnyRequestContext) {
      if (loaded !== undefined) return loaded.events.principalOf(ctx);
      return (ctx as unknown as { auth?: { principal?: string } }).auth
        ?.principal;
    },
    revoke: async (filter) => (await load()).events.revoke(filter),
    list: async (query) => (await load()).events.list(query),
    count: async (query) => (await load()).events.count(query),
    streams: () => loaded?.events.streams() ?? [],
    process: async (o) => (await load()).events.process(o),
    info: async () => (await load()).events.info(),
    health: async () => (await load()).events.health(),
  };

  return {
    get size() {
      return registry.size;
    },
    register(definition: AnyEventDefinition) {
      const registered = registry.add(definition);
      const ref: EventRef<string, unknown, unknown> = {
        name: registered.name,
        emit: (data, o) => events.emit(registered.name, data, o),
        terminate: (target) =>
          events.revoke({
            name: registered.name,
            ...(target.principal !== undefined && {
              principal: target.principal,
            }),
            ...(target.subscriptionId !== undefined && {
              subscriptionId: target.subscriptionId,
            }),
            reason: "terminated",
          }),
      };
      return ref;
    },
    events,
    preflight: async (request, parsedBody) =>
      (await load()).preflight(request, parsedBody),
    route: async (request) => (await load()).route(request),
    start: async (mode) => (await load()).start(mode),
    scheduled: async (env, ctx) => (await load()).scheduled(env, ctx),
    setWaitUntil(next) {
      waitUntil = next;
      loaded?.setWaitUntil(next);
    },
    async close() {
      if (loading !== undefined) await (await loading).close();
    },
  };
}
