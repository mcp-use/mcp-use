/**
 * The seam between `MCPServer` and Events. `server.ts` and `mount-mcp.ts`
 * call only this interface; WP-23 (registry, preflight, `server.events`) and
 * WP-24/WP-26 (binding, drivers, routes) implement it in
 * `events/server-events.ts`. This module stays static and tiny: the engine
 * is loaded lazily behind it (D28).
 *
 * @internal
 */

import type { EventsConfig } from "../config.js";
import type { AnyEventDefinition, EventRef, ServerEvents } from "../types.js";

/** What `MCPServer` passes when it creates the host. */
export interface EventsHostOptions {
  /** `ServerConfig.events`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the server's user type is erased here
  config: EventsConfig<any> | undefined;
  /** `ServerConfig.storage`. */
  storage: import("../../storage/types.js").McpUseStorage | undefined;
  /** Whether OAuth is configured (principal source, D13). */
  oauth: boolean;
  /** MCP base path, for `{basePath}/_mcp-use/events/*`. */
  basePath: () => string;
}

/** Mode the server starts in. */
export type EventsStartMode = "listen" | "handler";

/** The host `MCPServer` owns once Events is touched. */
export interface EventsHost {
  /** Number of registered events. */
  readonly size: number;
  /** Register an event (sync checks, §7.1.3). */
  register(definition: AnyEventDefinition): EventRef<string, unknown, unknown>;
  /** The runtime handle. */
  readonly events: ServerEvents;
  /**
   * Mount preflight: answer `events/*` requests (and reject batches that
   * contain one). Returns undefined for anything else.
   */
  preflight(
    request: Request,
    parsedBody: unknown
  ): Promise<Response | undefined>;
  /** Internal routes under `{basePath}/_mcp-use/events/`; undefined when the path is not one. */
  route(request: Request): Promise<Response | undefined>;
  /** Eager binding at `listen()` or first handler use; starts drivers. */
  start(mode: EventsStartMode): Promise<void>;
  /** Workers cron entrypoint: one tick. */
  scheduled(
    env: unknown,
    ctx: { waitUntil(p: Promise<unknown>): void }
  ): Promise<void>;
  /** Thread a runtime `waitUntil` (Next, TanStack Start, Workers). */
  setWaitUntil(waitUntil: ((p: Promise<unknown>) => void) | undefined): void;
  /** Graceful close: stop drivers, drain streams, close the backend. */
  close(): Promise<void>;
}
