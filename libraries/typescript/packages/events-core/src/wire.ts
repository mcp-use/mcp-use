/**
 * Wire vocabulary of MCP Events: constants, method and notification names,
 * and the request, result, notification and webhook body shapes of
 * SEP-3415 (`events.mdx` at `c77b843`) and the ChatGPT dialect. Names and
 * shapes follow the TypeScript SDK's `ext/events` types (PR #3209) so that
 * values cross between the two without conversion.
 *
 * @packageDocumentation
 */

/** The extension identifier a server advertises in `capabilities.extensions` on the 2026-07-28 era. */
export const EVENTS_EXTENSION_ID = "io.modelcontextprotocol/events";

/** The top-level capability key (`capabilities.events`) that ChatGPT and the legacy era read. */
export const LEGACY_EVENTS_CAPABILITY = "events";

/** The HTTP header that carries the subscription `id` on every webhook POST. */
export const SUBSCRIPTION_ID_HEADER = "X-MCP-Subscription-Id";

/** The `_meta` key that carries the stream's subscription id on every push frame. */
export const SUBSCRIPTION_ID_META_KEY =
  "io.modelcontextprotocol/subscriptionId";

/** The response header in which an mcp-use server names the dialect it served (`openai` or `sep-3415`). */
export const DIALECT_RESPONSE_HEADER = "x-mcp-use-events-dialect";

/** The largest webhook body, in bytes, a server delivers (256 KiB); larger events are not delivered by webhook. */
export const MAX_ENVELOPE_BYTES = 262_144;

/** The JSON-RPC method names of the five Events requests. */
export const EVENTS_METHODS = {
  /** Lists the event types a server offers. */
  list: "events/list",
  /** Creates or refreshes a webhook subscription. */
  subscribe: "events/subscribe",
  /** Removes a webhook subscription. */
  unsubscribe: "events/unsubscribe",
  /** Reads the events of one subscription since a cursor (poll delivery). */
  poll: "events/poll",
  /** Opens a long-lived SSE stream for one subscription (push delivery). */
  stream: "events/stream",
} as const;

/** One of the five Events request method names. */
export type EventsMethod = (typeof EVENTS_METHODS)[keyof typeof EVENTS_METHODS];

/** The JSON-RPC notification names of push delivery and of catalog changes. */
export const EVENTS_NOTIFICATIONS = {
  /** Confirms a push stream and carries the heartbeat grant; sent again mid-stream after a gap. */
  active: "notifications/events/active",
  /** Delivers one event occurrence on a push stream. */
  event: "notifications/events/event",
  /** Keeps a push stream alive and advances its cursor while no event matches. */
  heartbeat: "notifications/events/heartbeat",
  /** Reports a recoverable failure on a push stream, which stays open. */
  error: "notifications/events/error",
  /** Ends a push subscription from the server side. */
  terminated: "notifications/events/terminated",
  /** Tells a `subscriptions/listen` stream that the event catalog changed. */
  listChanged: "notifications/events/list_changed",
} as const;

/** One of the Events notification method names. */
export type EventsNotificationMethod =
  (typeof EVENTS_NOTIFICATIONS)[keyof typeof EVENTS_NOTIFICATIONS];

/** How events reach a subscriber: a signed POST, an SSE stream, or client reads. */
export type DeliveryMode = "webhook" | "push" | "poll";

/** Every delivery mode, in the order `events/list` lists them. */
export const DELIVERY_MODES: readonly DeliveryMode[] = [
  "webhook",
  "push",
  "poll",
];

/**
 * The categories a server reports as `deliveryStatus.lastError`, and as
 * `data.reason` of a CallbackEndpointError. HTTP status codes never reach the
 * wire.
 */
export type DeliveryErrorCategory =
  | "connection_refused"
  | "timeout"
  | "tls_error"
  | "http_4xx"
  | "http_5xx"
  | "challenge_failed";

/** Every {@link DeliveryErrorCategory}. */
export const DELIVERY_ERROR_CATEGORIES: readonly DeliveryErrorCategory[] = [
  "connection_refused",
  "timeout",
  "tls_error",
  "http_4xx",
  "http_5xx",
  "challenge_failed",
];

/**
 * The `_meta` of a push frame: the stream's subscription id (the JSON-RPC id
 * of the `events/stream` request) plus any keys the event carried.
 */
export type SubscriptionMeta = {
  [SUBSCRIPTION_ID_META_KEY]: string | number;
} & Record<string, unknown>;

/** One event type as `events/list` describes it. */
export interface EventDescriptor {
  /** The event name, unique on the server (for example `note.created`). */
  name: string;
  /** What the event means and what a model should do with it. */
  description?: string;
  /** The delivery modes this server offers for the event to this caller's profile. */
  delivery: DeliveryMode[];
  /** JSON Schema of the subscription `arguments`; may carry `x-mcp-header` annotations. */
  inputSchema: Record<string, unknown>;
  /** JSON Schema of each event's `data`; always present. */
  payloadSchema: Record<string, unknown>;
  /** Extension metadata, passed through unchanged. */
  _meta?: Record<string, unknown>;
}

/** One event occurrence as it travels in a webhook body, a push frame or a poll result. */
export interface EventEnvelope<T = unknown> {
  /** The event id: the upstream id, normalized per the profile's `eventIdNormalization` axis. */
  eventId: string;
  /** The event name. */
  name: string;
  /** When the event happened, ISO 8601 UTC. */
  timestamp: string;
  /** The payload, valid against the event's `payloadSchema`. */
  data: T;
  /** Resume position after this event; absent means `null`. Absent in poll results, which carry the cursor at the top level. */
  cursor?: string | null;
  /** Extension metadata of the occurrence. */
  _meta?: Record<string, unknown>;
}

/** Delivery health of a webhook subscription, returned on refresh under `sep-3415`. */
export interface DeliveryStatus {
  /** `false` while deliveries are suspended; a reactivating refresh reports `false`. */
  active: boolean;
  /** When the last delivery was acknowledged, ISO 8601 UTC, or `null` before the first. */
  lastDeliveryAt?: string | null;
  /** The last delivery failure as a {@link DeliveryErrorCategory}, or `null`. */
  lastError?: DeliveryErrorCategory | (string & {}) | null;
  /** Since when deliveries have been failing, ISO 8601 UTC. */
  failedSince?: string;
  /** `true` while the server delays deliveries to this callback (loop guard). */
  throttled?: boolean;
  /** How long the throttle is expected to last, in milliseconds. */
  retryAfterMs?: number;
}

/** Parameters of `events/list`. */
export interface ListEventsRequestParams {
  /** An opaque page cursor from a previous `nextCursor`. */
  cursor?: string;
}

/** Result of `events/list`. */
export interface ListEventsResult {
  /** One page of event types. */
  events: EventDescriptor[];
  /** Opaque cursor of the next page; absent on the last page. */
  nextCursor?: string;
}

/** Parameters of `events/subscribe` (create or refresh a webhook subscription). */
export interface SubscribeEventsRequestParams {
  /** The event name. */
  name: string;
  /** Subscription arguments; absent and `null` both mean `{}`. */
  arguments?: Record<string, unknown>;
  /** Where and how to deliver. */
  delivery: {
    /** Always `"webhook"`; `events/subscribe` serves webhook delivery only. */
    mode: "webhook";
    /** The https callback URL. */
    url: string;
    /** The Standard Webhooks secret, `whsec_` + base64 of 24 to 64 bytes. */
    secret: string;
  };
  /** Where to resume: `null` means "from now". Ignored on a live refresh. */
  cursor?: string | null;
  /** Replay floor: skip events appended longer ago than this many milliseconds. */
  maxAgeMs?: number;
  /** Requested lifetime in milliseconds; `null` asks for no expiry. The server decides. */
  ttlMs?: number | null;
}

/** Result of `events/subscribe`. */
export interface SubscribeEventsResult {
  /** The subscription id, `sub_` + 22 base64url characters, deterministic over the subscription key. */
  id: string;
  /** Refresh before this ISO 8601 UTC instant, or `null` for no expiry. */
  refreshBefore: string | null;
  /** The safe-to-persist watermark, or `null` when the event or profile has no replay. */
  cursor: string | null;
  /** `true` when delivery starts later than the supplied cursor. */
  truncated: boolean;
  /** Delivery health, on refresh under `sep-3415`. */
  deliveryStatus?: DeliveryStatus;
}

/** Parameters of `events/unsubscribe`. */
export interface UnsubscribeEventsRequestParams {
  /** The event name. */
  name: string;
  /** The subscription arguments the subscription was created with; absent and `null` mean `{}`. */
  arguments?: Record<string, unknown>;
  /** The callback the subscription delivers to. */
  delivery: {
    /** Always `"webhook"`. */
    mode: "webhook";
    /** The callback URL the subscription was created with. */
    url: string;
  };
}

/** Result of `events/unsubscribe`: an empty object. */
export type UnsubscribeEventsResult = Record<string, never>;

/** Parameters of `events/poll`. */
export interface PollEventsRequestParams {
  /** The event name. */
  name: string;
  /** Subscription arguments; absent and `null` both mean `{}`. */
  arguments?: Record<string, unknown>;
  /** Resume position from the previous poll result; `null` or absent starts at the head. */
  cursor?: string | null;
  /** Replay floor in milliseconds. */
  maxAgeMs?: number;
  /** Most events to return (the server clamps it). */
  maxEvents?: number;
}

/** Result of `events/poll`. */
export interface PollEventsResult {
  /** Matching events in log order; poll events carry no `cursor` field. */
  events: EventEnvelope[];
  /** Where the next poll resumes. */
  cursor: string | null;
  /** `true` when events were skipped (retention, reset or the `maxAgeMs` floor). */
  truncated: boolean;
  /** `true` when the scan stopped before the head; poll again at once. */
  hasMore: boolean;
  /** Advised delay before the next poll, an integer of at least 1000 milliseconds. */
  nextPollMs?: number;
}

/** Parameters of `events/stream`. */
export interface StreamEventsRequestParams {
  /** The event name. */
  name: string;
  /** Subscription arguments; absent and `null` both mean `{}`. */
  arguments?: Record<string, unknown>;
  /** Resume position; `null` or absent starts at the head. */
  cursor?: string | null;
  /** Replay floor in milliseconds. */
  maxAgeMs?: number;
  /** Requested heartbeat interval in milliseconds; the server grants a clamped value. */
  heartbeatMs?: number;
}

/** Params of `notifications/events/active`. */
export interface EventsActiveParams {
  /** The stream's start position. */
  cursor: string | null;
  /** `true` when the stream starts later than the requested cursor. */
  truncated: boolean;
  /** The heartbeat grant in milliseconds; always present. */
  heartbeatMs: number;
  /** Carries the stream's subscription id. */
  _meta: SubscriptionMeta;
}

/** Params of `notifications/events/event`: one occurrence plus the stream's subscription id. */
export interface EventsEventParams extends EventEnvelope {
  /** The event's own `_meta` merged with the stream's subscription id (the id wins). */
  _meta: SubscriptionMeta;
}

/** Params of `notifications/events/heartbeat`. */
export interface EventsHeartbeatParams {
  /** The stream's current position, which advances in quiet periods. */
  cursor: string | null;
  /** Carries the stream's subscription id. */
  _meta: SubscriptionMeta;
}

/** Params of `notifications/events/error`. */
export interface EventsErrorParams {
  /** A JSON-RPC error object. */
  error: {
    /** The JSON-RPC error code. */
    code: number;
    /** A short description. */
    message: string;
    /** Typed details (`reason`, `kind`, `limit`, `feature`). */
    data?: Record<string, unknown>;
  };
  /** Carries the stream's subscription id. */
  _meta: SubscriptionMeta;
}

/** Params of `notifications/events/terminated`: the same shape as an error frame. */
export type EventsTerminatedParams = EventsErrorParams;

/** The final result of an `events/stream` request, sent when the stream closes. */
export interface StreamEventsResult {
  /** Carries the stream's subscription id. */
  _meta: SubscriptionMeta;
}

/**
 * A webhook control envelope body. A body with a top-level `type` is a control
 * envelope; an event body has none.
 */
export type WebhookControlBody =
  | {
      /** Verification handshake: echo `challenge` in a 2xx JSON response. */
      type: "verification";
      /** The nonce to echo. */
      challenge: string;
    }
  | {
      /** Events were lost; resume from `cursor`. */
      type: "gap";
      /** The watermark at the time of the gap. */
      cursor: string | null;
    }
  | {
      /** The server ended the subscription. */
      type: "terminated";
      /** Why, as a JSON-RPC error object. */
      error: {
        /** The JSON-RPC error code. */
        code: number;
        /** A short description. */
        message: string;
        /** Typed details. */
        data?: unknown;
      };
    };

/** The body of a webhook event delivery (no top-level `type`). */
export interface WebhookEventBody<T = unknown> extends EventEnvelope<T> {
  /** The resume position after this event, or `null` without replay. */
  cursor: string | null;
}

/**
 * The webhook subscription record of the TypeScript SDK's Events extension
 * (PR #3209 `WebhookSubscriptionRecord`). mcp-use's stored record is a
 * superset; {@link toSdkWebhookRecord} projects it.
 */
export interface SdkWebhookSubscriptionRecord {
  /** The subscription id. */
  id: string;
  /** The principal that owns the subscription. */
  principal: string;
  /** The event name. */
  name: string;
  /** The subscription arguments as the client sent them (`{}` when absent). */
  arguments: Record<string, unknown>;
  /** The callback URL. */
  url: string;
  /** The current signing secret (`whsec_…`). */
  secret: string;
  /** The previous secret during a rotation window, and when it stops signing (epoch ms). */
  previousSecret?: {
    /** The previous `whsec_…` secret. */
    secret: string;
    /** Epoch milliseconds after which it no longer signs. */
    expiresAt: number;
  };
  /** Expiry, epoch milliseconds. */
  expiresAt: number;
  /** Creation time, epoch milliseconds. */
  createdAt: number;
}

/**
 * The fields of an mcp-use webhook subscription record that
 * {@link toSdkWebhookRecord} reads. Any record with these fields can be
 * projected; other fields are ignored.
 */
export interface SdkProjectableRecord {
  /** The subscription id. */
  id: string;
  /** The principal that owns the subscription. */
  principal: string;
  /** The event name. */
  name: string;
  /** The normalized subscription arguments. */
  args: Record<string, unknown>;
  /** The callback URL. */
  url: string;
  /** The current signing secret. */
  secret: string;
  /** The previous secret during a rotation window. */
  previousSecret?: {
    /** The previous `whsec_…` secret. */
    secret: string;
    /** Epoch milliseconds after which it no longer signs. */
    expiresAt: number;
  };
  /** Expiry in epoch milliseconds, or `null` for a subscription without expiry. */
  expiresAt: number | null;
  /** Creation time, epoch milliseconds. */
  createdAt: number;
}

/**
 * The `expiresAt` that {@link toSdkWebhookRecord} writes for a subscription
 * without expiry, since the SDK record requires a number:
 * `Number.MAX_SAFE_INTEGER`.
 */
export const SDK_NO_EXPIRY = Number.MAX_SAFE_INTEGER;

/**
 * Projects an mcp-use webhook subscription record onto the nine fields of the
 * SDK's `WebhookSubscriptionRecord`. Pure: it copies values and never reads
 * other fields. A `null` expiry becomes {@link SDK_NO_EXPIRY}.
 *
 * @param record - A stored mcp-use webhook subscription record (or any value with its fields).
 * @returns A new record the SDK's `WebhookSubscriptionStore` accepts.
 */
export function toSdkWebhookRecord(
  record: SdkProjectableRecord
): SdkWebhookSubscriptionRecord {
  const out: SdkWebhookSubscriptionRecord = {
    id: record.id,
    principal: record.principal,
    name: record.name,
    arguments: { ...record.args },
    url: record.url,
    secret: record.secret,
    expiresAt: record.expiresAt ?? SDK_NO_EXPIRY,
    createdAt: record.createdAt,
  };
  if (record.previousSecret !== undefined) {
    out.previousSecret = {
      secret: record.previousSecret.secret,
      expiresAt: record.previousSecret.expiresAt,
    };
  }
  return out;
}
