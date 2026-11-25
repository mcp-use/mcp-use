/**
 * Public MCP Events client contract (PLAN.md §9.5, D59). Type-only plus the
 * error class; no `@modelcontextprotocol/*` import.
 *
 * @packageDocumentation
 */

import type {
  DeliveryMode,
  EventDescriptor,
  EventEnvelope,
} from "@mcp-use/events-core";

/** What the client knows about one server's Events support. */
export interface EventsInfo {
  /** Whether the server advertises Events (extension or legacy key). */
  supported: boolean;
  /** How support was detected. */
  via: "extension" | "legacy-capability" | "probe" | "none";
  /** Events listed by the server (cached per session). */
  events: readonly EventDescriptor[];
}

/** Persistence for the manager. Public and separate from the internal auth KV store. */
export interface EventsStore {
  /** Read a value. */
  get(key: string): Promise<string | undefined>;
  /** Write a value. */
  set(key: string, value: string): Promise<void>;
  /** Delete a value. */
  delete(key: string): Promise<void>;
  /** List keys with a prefix. */
  list(prefix: string): Promise<string[]>;
}

/** Webhook part of a persisted subscription. */
export interface ClientWebhookState {
  /** The receiver URL subscribed. */
  receiverUrl: string;
  /** Server subscription id. */
  subscriptionId: string;
  /** Current `whsec_` secret. */
  secret: string;
  /** Previous secret during rotation. */
  previousSecret?: string;
  /** ISO 8601. */
  secretRotatedAt: string;
  /** ISO 8601 or null. */
  refreshBefore: string | null;
}

/**
 * One persisted record per subscription (D59). Final shape; `v: 1` forever,
 * unknown fields preserved. Store key:
 * `sub/<server>/<base64url(SHA-256(name ‖ 0x00 ‖ argsKey))[0..22]>`.
 */
export interface ClientSubscriptionRecord {
  /** Record version. */
  v: 1;
  /** The MCPClient server key. */
  server: string;
  /** Event name. */
  name: string;
  /** Subscription arguments. */
  args: Record<string, unknown>;
  /** `canonicalJson(normalizeArguments(args))`. */
  argsKey: string;
  /** Delivery mode. */
  mode: DeliveryMode;
  /** Resume cursor. */
  cursor: string | null;
  /** Replay floor for the first request. */
  maxAgeMs?: number;
  /** Resolved emulation (`"auto"`, `"sep-3415"`, row id). */
  dialect: string;
  /** ISO 8601. */
  createdAt: string;
  /** ≤ 64, newest last: restart-safe dedupe. */
  recentEventIds: string[];
  /** Webhook state. */
  webhook?: ClientWebhookState;
}

/** Receiver configuration for webhook mode. */
export type EventsReceiverOptions =
  | {
      /** Public URL that forwards to `createWebhookHandler()`. */
      url: string;
    }
  | {
      /** Start a local listener (Node, dev). */
      listen: { port: number; tunnel?: boolean };
    };

/** Dialect emulation: `"auto"`, `"sep-3415"` or a `KNOWN_CLIENTS` row id. */
export type ClientDialectOption = "auto" | "sep-3415" | (string & {});

/** Options of the events manager (`MCPClient` `events`). */
export interface EventsManagerOptions {
  /** Receiver for webhook mode; omit for push and poll only. */
  receiver?: EventsReceiverOptions;
  /** Persistence. Default: memory in Node, localStorage in browsers. */
  store?: EventsStore;
  /** Dialect emulation. Default `"auto"`. */
  dialect?: ClientDialectOption;
  /** Mode preference. Default `["webhook","push","poll"]` with a receiver, `["push","poll"]` without. */
  prefer?: readonly DeliveryMode[];
  /** Resume persisted subscriptions when a session opens. Default `"auto"`. */
  resume?: "auto" | "off";
  /** Probe `events/list` on servers that advertise nothing. Default false. */
  probe?: boolean;
}

/** Gap notice passed to `onGap`. */
export interface EventsGap {
  /** Cursor to resume from, if any. */
  cursor: string | null;
  /** Why the gap happened. */
  reason: "truncated" | "gap";
}

/** Termination notice passed to `onTerminated`. */
export interface EventsTermination {
  /** Decoded error kind. */
  kind: string;
  /** Wire code. */
  code: number;
  /** Error data. */
  data?: Record<string, unknown>;
}

/** Options of one `client.events.subscribe` call. */
export interface ClientSubscribeOptions {
  /** Force one mode. */
  mode?: DeliveryMode;
  /** Webhook TTL. */
  ttlMs?: number;
  /** Explicit start cursor. */
  cursor?: string | null;
  /** Replay floor for the first request. */
  maxAgeMs?: number;
  /** Called on a gap or truncation. */
  onGap?: (gap: EventsGap) => void;
  /** Called on termination. */
  onTerminated?: (t: EventsTermination) => void;
}

/** Runner options shared by the poll, push and webhook runners. */
export interface EventsRunnerOptions {
  /** The persisted record the runner drives. */
  record: ClientSubscriptionRecord;
  /** Store for cursor writes. */
  store: EventsStore;
  /** Delivery callback. */
  onEvent: (event: EventEnvelope) => void | Promise<void>;
  /** Error callback. */
  onError: (error: EventsClientError) => void;
  /** Abort signal. */
  signal: AbortSignal;
}

/** Typed client error codes (§9.5.8). */
export type EventsClientErrorCode =
  | "mode_unavailable"
  | "receiver_required"
  | "auth_required"
  | "refresh_storm"
  | "delivery_suspended"
  | "not_supported"
  | "terminated"
  | "MCP_NAME_CONFLICT"
  | "EVENTS_SDK_EXTENSION_CONFLICT"
  | "TUNNEL_NOT_FOR_PRODUCTION";

/** A typed Events client error. */
export class EventsClientError extends Error {
  /** Stable code. */
  readonly code: EventsClientErrorCode;
  /** Server key. */
  readonly server?: string;
  /** Event name. */
  readonly eventName?: string;
  /** Details. */
  readonly data?: Record<string, unknown>;

  /**
   * @param code - Stable code.
   * @param message - Description.
   * @param details - Server, event name and data.
   */
  constructor(
    code: EventsClientErrorCode,
    message: string,
    details: {
      server?: string;
      name?: string;
      data?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = "EventsClientError";
    this.code = code;
    if (details.server !== undefined) this.server = details.server;
    if (details.name !== undefined) this.eventName = details.name;
    if (details.data !== undefined) this.data = details.data;
  }
}
