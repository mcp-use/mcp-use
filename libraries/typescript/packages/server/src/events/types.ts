/**
 * Public MCP Events types of `mcp-use` (PLAN.md §7.1, §7.2, §12.3.2).
 *
 * Type-only and edge-safe. No type here mentions an `@modelcontextprotocol/*`
 * type (D81): schemas are described structurally by {@link EventSchema}.
 *
 * @packageDocumentation
 */

import type {
  DeliveryErrorCategory,
  DeliveryMode,
  EventsError,
} from "@mcp-use/events-core";
import type { Env } from "hono";
import type { RequestContext } from "../context.js";

export type { DeliveryMode, DeliveryErrorCategory } from "@mcp-use/events-core";

/** A duration in ms, or a string such as `"30s"`, `"10m"`, `"24h"`, `"7d"`. */
export type Duration = number | `${number}${"ms" | "s" | "m" | "h" | "d"}`;

/** Preset ids are open strings (D53): a new preset row never changes this type. */
export type DialectId = "openai" | "sep-3415" | (string & {});

/** Why `onUnsubscribe` runs. */
export type UnsubscribeReason =
  | "unsubscribed"
  | "expired"
  | "revoked"
  | "terminated"
  | "closed";

/**
 * A Standard Schema that can also export JSON Schema (zod v4, ArkType,
 * Valibot, …). Structurally compatible with the SDK's `StandardSchemaWithJSON`
 * without importing it (D81).
 */
export interface EventSchema<Input = unknown, Output = Input> {
  /** The Standard Schema property. */
  readonly "~standard": {
    /** Standard Schema version. */
    readonly version: 1;
    /** The schema library. */
    readonly vendor: string;
    /** Validates a value. */
    readonly validate: (value: unknown) => unknown;
    /** Phantom input and output types. */
    readonly types?:
      | { readonly input: Input; readonly output: Output }
      | undefined;
  };
}

/** Output type of an optional input schema; `Record<string, never>` when absent. */
export type EventArgs<I> =
  I extends EventSchema<unknown, infer O> ? O : Record<string, never>;
/** The type `emit()` accepts for a payload schema. */
export type EventPayloadIn<P> =
  P extends EventSchema<infer In, unknown> ? In : never;
/** The validated payload type for a payload schema. */
export type EventPayloadOut<P> =
  P extends EventSchema<unknown, infer Out> ? Out : never;

/** Context passed to a custom `match` function. */
export interface MatchContext {
  /** The subscriber's principal. */
  principal: string;
  /** Webhook: the subscription id. Poll and push: the direct id (D23), stable for (principal, name, args). */
  subscriptionId: string;
  /** The pinned dialect. */
  dialect: DialectId;
  /** The delivery mode. */
  mode: DeliveryMode;
}

/** A subscription or direct lease as seen by `onSubscribe` and `onUnsubscribe`. */
export interface SubscriptionInfo<A> {
  /** Webhook: `sub_…`. Poll and push: the direct id (never on the wire). */
  id: string;
  /** The event name. */
  name: string;
  /** The subscription arguments. */
  args: A;
  /** The subscriber's principal. */
  principal: string;
  /** The pinned dialect. */
  dialect: DialectId;
  /** The delivery mode. */
  mode: DeliveryMode;
  /** Webhook: origin only, never the full URL. Poll and push: null. */
  callbackOrigin: string | null;
  /** Webhook: grant expiry. Poll and push: lease expiry. */
  expiresAt: Date | null;
  /** True on creation; false when a hook runs from a job. */
  created: boolean;
}

/**
 * Definition passed to `server.event()` (or `defineEvent()` for sharing with
 * other processes). See PLAN.md §7.1 for every field's semantics.
 */
export interface EventDefinition<
  Name extends string = string,
  I extends EventSchema | undefined = EventSchema | undefined,
  P extends EventSchema = EventSchema,
  TUser = never,
  TEnv extends Env = Env,
> {
  /** `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`; the `mcp.` prefix is reserved. Keep it stable: clients key on it. */
  name: Name;
  /** Required. ChatGPT decides how to react from this text alone. */
  description: string;
  /** Subscription arguments (filters). Omit for none. Advertised as its input JSON Schema. */
  inputSchema?: I;
  /** Shape of `data` in every occurrence. Advertised as its output JSON Schema. */
  payloadSchema: P;
  /**
   * Delivery-time filter. Default `"auto"` (D4): equality on top-level input
   * keys that also exist as scalars in the payload. A function replaces
   * auto-matching; it runs with no request context.
   */
  match?:
    | "auto"
    | ((
        args: EventArgs<I>,
        data: EventPayloadOut<P>,
        ctx: MatchContext
      ) => boolean | Promise<boolean>);
  /** Permission check with the full request context (subscribe, refresh, poll, stream open and every 15 min). Default: allow. */
  authorize?: (
    args: EventArgs<I>,
    ctx: RequestContext<TUser, "optional", TEnv>
  ) => boolean | Promise<boolean>;
  /** Hide from some callers' `events/list`; hidden events answer NotFound. Default: visible. */
  visible?: (
    ctx: RequestContext<TUser, "optional", TEnv>
  ) => boolean | Promise<boolean>;
  /** OAuth scopes requested at sign-in and enforced on subscribe, poll and stream with a 403 step-up (D39). */
  scopes?: readonly string[];
  /** Fan-out index key shared by args and payload (D5). Default: the first required auto-matched key. */
  partitionBy?: keyof EventArgs<I> & keyof EventPayloadOut<P> & string;
  /** Per-event TTL bounds for webhook subscriptions (D21). */
  ttl?: { default?: Duration; max?: Duration };
  /** Replay window (D50). `false` makes the event non-replayable. Bounds: maxAge 1m–30d; maxEvents 1–100,000. */
  replay?: false | { maxAge?: Duration; maxEvents?: number };
  /** Turn modes off for this event. Default: every mode that can be served (§7.1.2). */
  delivery?: { webhook?: boolean; poll?: boolean; push?: boolean };
  /** `nextPollMs` for this event. Integer ms ≥ 1000. Default `events.poll.interval`. */
  pollInterval?: Duration;
  /** Runs inline on webhook creation or direct-lease creation (D58). Throw {@link EventsError} to refuse. */
  onSubscribe?: (
    sub: SubscriptionInfo<EventArgs<I>>,
    ctx: RequestContext<TUser, "optional", TEnv>
  ) => void | Promise<void>;
  /** Runs at least once from a durable job; must be idempotent (D64). No request context. */
  onUnsubscribe?: (
    sub: SubscriptionInfo<EventArgs<I>>,
    reason: UnsubscribeReason
  ) => void | Promise<void>;
  /** Passed through on the `events/list` descriptor. */
  _meta?: Record<string, unknown>;
}

/** Any request context, whatever its user, auth mode and env (variance-erased). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRequestContext = RequestContext<any, any, any>;

/** Any event definition, whatever its schemas, user and env (variance-erased). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEventDefinition = EventDefinition<string, any, any, any, any>;

/** Options for one emit. */
export interface EmitOptions {
  /** Upstream-stable id; repeats for the same target within 24 h dedupe (D57). Generated (`evt_<ulid>`) if absent. */
  eventId?: string;
  /** Occurrence time. Default: now. */
  timestamp?: Date | string;
  /** Deliver only to these principals' subscriptions and pollers. */
  principal?: string | readonly string[];
  /** Deliver only to this webhook subscription. */
  subscriptionId?: string;
  /** A tool ctx or Hono context, so the first dispatch can run in `waitUntil`. */
  ctx?:
    | { executionCtx?: { waitUntil(p: Promise<unknown>): void } }
    | AnyRequestContext;
  /** `"throw"` (default) or `"log"`: log and resolve with `accepted: false` (D47). */
  onError?: "throw" | "log";
  /** Occurrence `_meta`, merged into stream frames and webhook bodies. */
  _meta?: Record<string, unknown>;
}

/** Result of one emit. */
export interface EmitResult {
  /** The id as accepted (raw). */
  eventId: string;
  /** True when this eventId was already emitted for the same target within 24 h. */
  duplicate: boolean;
  /** False only with `onError: "log"` when the append failed. */
  accepted: boolean;
}

/** Returned by `server.event()`: typed `emit`, plus phantom types for client inference. */
export interface EventRef<
  Name extends string = string,
  A = unknown,
  P = unknown,
> {
  /** The event name. */
  readonly name: Name;
  /** Validate, dedupe and append to the event log in one atomic write (D17, D18). */
  emit(data: P, options?: EmitOptions): Promise<EmitResult>;
  /** End subscriptions of this event; returns the number of webhook subscriptions and leases ended. */
  terminate(
    target: { principal?: string; subscriptionId?: string; all?: true },
    error?: EventsError
  ): Promise<number>;
  /** Phantom types. */
  readonly "~types"?: { args: A; payload: P };
}

/** Infer the argument type of an {@link EventRef}. */
export type InferEventArgs<R> =
  R extends EventRef<string, infer A, unknown> ? A : never;
/** Infer the payload type of an {@link EventRef}. */
export type InferEventPayload<R> =
  R extends EventRef<string, unknown, infer P> ? P : never;

/** One pass of due work (`process()`, the tick route, `pingTick`). */
export interface TickReport {
  /** Delivery, control, hook and replay jobs attempted plus dispatcher runs. */
  attempted: number;
  /** Records and leases expired by the sweep in this pass. */
  expired: number;
  /** Due work still overdue when the budget ran out. */
  remaining: number;
  /** min(first score of idx due, first score of idx fanout-due), ISO 8601, or null (D63). */
  nextWakeAt: string | null;
}

/** SDK identity and probe outcomes; the same field set everywhere (D79). */
export interface EventsSdkInfo {
  /** The SDK compiled into mcp-use. */
  bundled: string;
  /** Hash of the inlined SDK sources. */
  bundledHash: string;
  /** Resolved external `@modelcontextprotocol/server` version, if any. */
  external?: string;
  /** Startup self-test result of the patched result predicate. */
  patchedPredicate: string;
  /** D79 probe outcomes. */
  probes: Record<string, "ok" | "fail">;
}

/** Resolved binding and runtime facts (`server.events.info()`). */
export interface EventsInfo {
  /** Engine state. */
  state: "ready" | "degraded" | "unconfigured" | "inert";
  /** Which binding was resolved (open string). */
  binding: "user" | "dev" | "platform" | "memory" | "inert" | (string & {});
  /** Storage kind. */
  kind: string;
  /** Where the store came from. */
  source: string;
  /** Storage layout. */
  layout: 1 | (number & {});
  /** Environment identity. */
  namespace: string;
  /** Hash of the namespace used in keys. */
  nsHash: string;
  /** Whether the store survives restarts. */
  durable: boolean;
  /** Whether instances share the store. */
  shared: boolean;
  /** Storage capabilities. */
  capabilities: { signal: boolean; batch: boolean };
  /** The sender (open string). */
  sender: "node-pinned" | "node-pinned+proxy" | "fetch" | (string & {});
  /** The work driver. */
  worker: "pump" | "lazy-pump" | "off" | "serverless";
  /** Push facts. */
  push: {
    enabled: boolean;
    maxDurationMs: number | null;
    heartbeatMaxMs: number;
    tail: "signal" | "shared" | "perStream";
  };
  /** Poll facts. */
  poll: { enabled: boolean; intervalMs: number };
  /** SDK identity (reported, never branched on). */
  sdk: EventsSdkInfo;
}

/** The health object (`GET …/_mcp-use/events/health`, `server.events.health()`); §12.3.2. */
export interface EventsHealth {
  /** Engine state. */
  state: "ready" | "degraded" | "unconfigured";
  /** For example `"sdk_capability_conflict"`. */
  reason?: string;
  /** Which binding was resolved. */
  binding: "user" | "dev" | "platform" | "memory" | "inert" | (string & {});
  /** Storage kind. */
  kind: string;
  /** Storage layout, or null when unknown. */
  layout: 1 | null;
  /** Whether the store survives restarts. */
  durable: boolean;
  /** Whether instances share the store. */
  shared: boolean;
  /** Namespace hash. */
  nsHash: string;
  /** Due jobs. */
  due: number;
  /** Age of the oldest due job. */
  oldestDueAgeMs: number | null;
  /** Next wake time (D63). */
  nextWakeAt: string | null;
  /** Dead letters retained. */
  deadLetters: number;
  /** Live webhook subscriptions. */
  subscriptions: number;
  /** Suspended webhook subscriptions. */
  suspended: number;
  /** Subscriptions never refreshed. */
  neverRefreshed: number;
  /** Hosts with an open circuit breaker. */
  circuitOpenHosts: number;
  /** The sender. */
  sender: "node-pinned" | "node-pinned+proxy" | "fetch" | (string & {});
  /** SDK identity. */
  sdk: EventsSdkInfo;
  /** Build identity. */
  build: { sha: string };
  /** Tick counters. */
  ticks: { count: number; last: string | null };
  /** Sweeper leadership. */
  sweeper: { leader: boolean; instance: string };
}

/** Admin view of a webhook subscription or a direct lease (no secrets). */
export interface SubscriptionView {
  /** `sub_…` or a direct id. */
  id: string;
  /** Event name. */
  name: string;
  /** Subscription arguments. */
  args: Record<string, unknown>;
  /** Principal. */
  principal: string;
  /** Delivery mode. */
  mode: DeliveryMode;
  /** Pinned profile. */
  profile: { preset: DialectId; revision: number; via: string };
  /** Protocol era. */
  era: "legacy" | "modern";
  /** Partition value, or null. */
  partition: string | null;
  /** Webhook only: origin, never the full URL. */
  callbackOrigin: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  refreshedAt: string;
  /** ISO 8601 or null (no expiry). */
  expiresAt: string | null;
  /** Delivery status. */
  status: "active" | "suspended";
  /** Webhook, replayable events: the cursor a refresh would return now. Otherwise null. */
  watermark: string | null;
  /** Last successful delivery. */
  lastDeliveryAt?: string;
  /** Last delivery error. */
  lastError?: DeliveryErrorCategory;
  /** Client name from signals. */
  clientName?: string;
}

/** One stream open on this instance. */
export interface StreamView {
  /** Event name. */
  name: string;
  /** Principal (hashed on admin routes). */
  principal: string;
  /** ISO 8601. */
  openedAt: string;
  /** Last cursor sent, or null. */
  position: string | null;
  /** Bytes queued for the client. */
  backlogBytes: number;
}

/** Query for {@link ServerEvents.list}. */
export interface SubscriptionListQuery {
  /** Event name. */
  name?: string;
  /** Principal. */
  principal?: string;
  /** Delivery mode. */
  mode?: DeliveryMode;
  /** Delivery status. */
  status?: "active" | "suspended";
  /** Page cursor from a previous `next`. */
  after?: string;
  /** Page size. */
  limit?: number;
}

/** Revoke filter: at least one of `principal` or `subscriptionId`. */
export interface RevokeFilter {
  /** Revoke this principal's subscriptions. */
  principal?: string;
  /** Revoke this subscription. */
  subscriptionId?: string;
  /** Narrow to one event name. */
  name?: string;
  /** Reason recorded on the tombstone. */
  reason?: string;
}

/** The runtime handle `server.events` (§7.2). */
export interface ServerEvents {
  /** Emit by name (untyped); prefer the {@link EventRef}. */
  emit(name: string, data: unknown, options?: EmitOptions): Promise<EmitResult>;
  /** The principal subscriptions are keyed by, for the caller of this request (D13). */
  principalOf(ctx: AnyRequestContext): string | undefined;
  /** Revoke matching subscriptions and leases (D37); returns the number removed. */
  revoke(filter: RevokeFilter): Promise<number>;
  /** Admin listing: no secrets, callback origin only. */
  list(
    query?: SubscriptionListQuery
  ): Promise<{ items: SubscriptionView[]; next?: string }>;
  /** Live webhook subscriptions plus live leases for a name (optionally exact args). */
  count(query: {
    name: string;
    args?: Record<string, unknown>;
  }): Promise<number>;
  /** Streams open on this instance. */
  streams(): ReadonlyArray<StreamView>;
  /** Run one pass of due work and, when its leader lease is free, the sweep. */
  process(options?: { budgetMs?: number }): Promise<TickReport>;
  /** Resolved binding and runtime facts. */
  info(): Promise<EventsInfo>;
  /** The health object. */
  health(): Promise<EventsHealth>;
}

/** The webhook sender seam (#3209-compatible shape, §8.15). */
export interface WebhookSender {
  /** Sender label reported by `info()`. */
  readonly kind: string;
  /** POST one body to a callback URL. Never follows redirects. */
  send(request: WebhookSendRequest): Promise<WebhookSendResult>;
}

/** One outbound webhook POST. */
export interface WebhookSendRequest {
  /** Callback URL. */
  url: string;
  /** Request headers (signature headers included). */
  headers: Record<string, string>;
  /** Exact body bytes. */
  body: string;
  /** Total timeout in ms. */
  timeoutMs: number;
  /** Connect timeout in ms. */
  connectTimeoutMs: number;
  /** Abort signal. */
  signal?: AbortSignal;
}

/** Outcome of one outbound webhook POST. */
export type WebhookSendResult =
  | {
      ok: true;
      status: number;
      headers: Record<string, string>;
      /** Up to 4 KiB of the response body. */
      body: string;
      /** Duration in ms. */
      ms: number;
    }
  | {
      /** The request failed before a response. */
      ok: false;
      /** Failure category. */
      error: DeliveryErrorCategory;
      /** Duration in ms. */
      ms: number;
    };
