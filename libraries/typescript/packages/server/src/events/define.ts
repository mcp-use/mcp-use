/**
 * Public types of MCP Events (the ChatGPT / OpenAI dialect, webhook delivery).
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
    args: Infer<I, Record<string, unknown>>,
    data: Infer<P, unknown>
  ) => boolean;
}

type Infer<S, Fallback> = S extends StandardSchemaWithJSON
  ? StandardSchemaWithJSON.InferOutput<S>
  : Fallback;

/** Options for {@link EventHandle.emit}. */
export interface EmitOptions {
  /** Unique, stable id; sent as `eventId` and `webhook-id`. Generated when omitted. */
  eventId?: string;
  /** Occurrence time; defaults to now. */
  timestamp?: Date;
}

/** Result of {@link EventHandle.emit}. */
export interface EmitResult {
  eventId: string;
  /** Matching subscriptions a delivery was queued for. */
  deliveries: number;
}

/** Returned by `server.event()`. */
export interface EventHandle<P = unknown> {
  readonly name: string;
  /**
   * Deliver an event to every matching subscription. Resolves after the
   * first delivery attempt of each; failed attempts are retried with backoff.
   */
  emit(data: P, options?: EmitOptions): Promise<EmitResult>;
}

/** `ServerConfig.events`. */
export interface EventsOptions {
  /**
   * Subscription storage. Defaults to Redis over Upstash REST when
   * `MCP_USE_PLATFORM_STORAGE_URL` and `_TOKEN` are set, else memory.
   */
  store?: EventsStore;
  /** Lifetime granted when `ttlMs` is omitted. Default 24 hours. */
  defaultTtlMs?: number;
  /**
   * Allow `http:` and private callback addresses. Development only; the
   * `mcp-use dev` runtime sets `MCP_USE_EVENTS_INSECURE=1`.
   */
  allowInsecureCallbacks?: boolean;
  /** Custom transport for deliveries (bypasses address checks). */
  fetch?: typeof fetch;
}

/** @internal */
export type AnyEventDefinition = EventDefinition<
  StandardSchemaWithJSON | undefined,
  StandardSchemaWithJSON | undefined
>;
