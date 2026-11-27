/**
 * Public types of MCP Events: the ChatGPT (OpenAI) dialect and the official
 * SEP-3415 extension (webhook and poll delivery).
 * The runtime lives in `./runtime.ts` and loads on first use.
 */

import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";

import type { EventsStore } from "./store.js";

/** An event a server publishes, listed by `events/list`. */
export interface EventDefinition<
  I extends StandardSchemaWithJSON | undefined = undefined,
  P extends StandardSchemaWithJSON | undefined = undefined,
> {
  /** Event name, for example `message.created`. */
  name: string;
  /** What the event means, shown to users choosing what to monitor. */
  description?: string;
  /** Subscribe `arguments` (filters). Defaults to an empty object. */
  inputSchema?: I;
  /** The event `data`. Emitted data is validated against it. */
  payloadSchema?: P;
  /**
   * Custom filter. By default a subscription matches when every argument
   * whose name is also a top-level field of `data` has an equal value.
   */
  matches?: (
    args: InferEventSchema<I, Record<string, unknown>>,
    data: InferEventSchema<P, unknown>
  ) => boolean;
}

/**
 * Output type of an event's `inputSchema` or `payloadSchema`, or `Fallback`
 * when the definition has no schema.
 */
export type InferEventSchema<S, Fallback> = S extends StandardSchemaWithJSON
  ? StandardSchemaWithJSON.InferOutput<S>
  : Fallback;

/** Options for {@link EventHandle.emit}. */
export interface EmitOptions {
  /** Unique, stable id (`eventId`). Generated when omitted. */
  eventId?: string;
  /** Occurrence time; defaults to now. */
  timestamp?: Date;
}

/** Result of {@link EventHandle.emit}. */
export interface EmitResult {
  /** Id of the emitted event: `options.eventId`, or the generated one. */
  eventId: string;
  /** Matching subscriptions a delivery was queued for. */
  deliveries: number;
}

/** Returned by `server.event()`. */
export interface EventHandle<P = unknown> {
  /** Event name, as declared in the definition passed to `server.event()`. */
  readonly name: string;
  /**
   * Deliver an event to every matching subscription. Resolves once the
   * deliveries are queued and, normally, after their first attempt (a large
   * backlog is attempted in batches); failed attempts are retried with
   * backoff.
   */
  emit(data: P, options?: EmitOptions): Promise<EmitResult>;
}

/** `ServerConfig.events`. */
export interface EventsOptions {
  /**
   * Subscription storage. Defaults to Redis over Upstash REST when
   * `MCP_USE_PLATFORM_STORAGE_URL` and `_TOKEN` are set, a file under
   * `.mcp-use/state/events/` in `mcp-use dev`, else memory.
   */
  store?: EventsStore;
  /** `nextPollMs` returned by `events/poll`. Default 5000. */
  pollIntervalMs?: number;
  /** Lifetime granted when `ttlMs` is omitted. Default 24 hours. */
  defaultTtlMs?: number;
  /**
   * Allow `http:` and private callback addresses, and webhook subscriptions
   * from unauthenticated clients (official dialect). Development only; the
   * `mcp-use dev` runtime sets `MCP_USE_EVENTS_INSECURE=1`.
   */
  allowInsecureCallbacks?: boolean;
  /**
   * Custom transport for deliveries. Skips the DNS-resolved address check;
   * callback URLs with a literal private IP are still rejected.
   */
  fetch?: typeof fetch;
}

/** @internal */
export type AnyEventDefinition = EventDefinition<
  StandardSchemaWithJSON | undefined,
  StandardSchemaWithJSON | undefined
>;
