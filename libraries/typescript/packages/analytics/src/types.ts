/**
 * Public types: the `manufact.sdk.v1` wire format, `instrument()` options and
 * the context passed to the `identify` / `conversationId` hooks.
 */

/** Wire schema identifier sent with every batch. */
export const WIRE_SCHEMA = "manufact.sdk.v1";

/** Framework an event was recorded from (`sdk.framework` on the wire). */
export type Framework =
  | "mcp-sdk-v1"
  | "mcp-sdk-v2"
  | "skybridge"
  | "mcp-handler"
  | "mcp-use"
  | "mcp-use-v1";

/** How a request ended. */
export type Outcome = "success" | "tool_error" | "error";

/** Transport the request arrived on. */
export type Transport = "streamable-http" | "sse" | "stdio";

/** HTTP facts about the request, when it arrived over HTTP. */
export interface AnalyticsHttpInfo {
  /** HTTP response status, when the adapter sees the HTTP response. */
  status?: number;
  /** HTTP request method (normally `POST`). */
  method?: string;
  /** Request path, for example `/mcp`. */
  path?: string;
  /** Client-facing host: the first `X-Forwarded-Host` entry, else `Host`. */
  host?: string;
  /** `User-Agent` (at most 4096 characters); used server-side to name unknown clients. */
  user_agent?: string;
  /** `Origin` header. */
  origin?: string;
  /** `Referer` header. */
  referer?: string;
  /** ISO-3166 alpha-2 country from the hosting platform (`CF-IPCountry`, `X-Vercel-IP-Country`). */
  country?: string;
}

/** The caller, as far as the server can tell. Never a raw token. */
export interface AnalyticsActor {
  /**
   * Hex SHA-256 identity of the caller's Bearer token, computed like the
   * gateway, or of the `id` returned by `identify`. The SDK sends an actor
   * only with one.
   */
  token_hash?: string;
  /** Display name; sent only when the dashboard's "Identify actors" setting is on. */
  name?: string;
  /** Email; sent only when the dashboard's "Identify actors" setting is on. */
  email?: string;
}

/** ChatGPT (OpenAI Apps SDK) identifiers carried in `_meta`. */
export interface AnalyticsOpenAiInfo {
  /** `_meta["openai/session"]`, the ChatGPT conversation. */
  session?: string;
  /** `_meta["openai/subject"]`, the anonymized ChatGPT user. */
  subject?: string;
  /** `_meta["openai/organization"]`. */
  organization?: string;
  /** `_meta["openai/userLocation"].country`. */
  country?: string;
}

/** A client's name and version. */
export interface AnalyticsClientInfo {
  /** Client name, for example `claude-ai`. */
  name?: string;
  /** Client version. */
  version?: string;
}

/** One event per JSON-RPC request, as sent to the ingest endpoint. */
export interface AnalyticsEvent {
  /** Unique event id (UUIDv7), reused when a batch is retried. */
  id: string;
  /** Request start, ISO 8601. */
  time: string;
  /** Handler latency in milliseconds. */
  duration_ms?: number;
  /** Exact JSON-RPC method (`initialize`, `tools/call`, …). */
  method: string;
  /** JSON-RPC request id. */
  request_id?: string | number;
  /** Tool name, resource URI or prompt name. */
  target?: string;
  /** How the request ended. */
  outcome?: Outcome;
  /** Error details when `outcome` is not `success`; `message` is at most 500 characters. */
  error?: {
    /** JSON-RPC error code. */
    code?: number;
    /** Error message, or the joined text content of an `isError` tool result. */
    message?: string;
  };
  /** Transport session (`Mcp-Session-Id`), or this process's stdio session. */
  session_id?: string;
  /** Conversation id returned by the `conversationId` option. */
  conversation_id?: string;
  /** Best known client identity. */
  client?: AnalyticsClientInfo;
  /** Raw `initialize` `params.clientInfo` (initialize events only). */
  client_info?: unknown;
  /** MCP protocol version of the request. */
  protocol_version?: string;
  /** Transport the request arrived on. */
  transport?: Transport;
  /** Whether the HTTP transport is stateless (no session). */
  stateless?: boolean;
  /** HTTP facts, when the request arrived over HTTP. */
  http?: AnalyticsHttpInfo;
  /** The caller, never a raw token. */
  actor?: AnalyticsActor;
  /** ChatGPT identifiers from `_meta`. */
  openai?: AnalyticsOpenAiInfo;
  /** W3C trace id from `_meta.traceparent` or the `traceparent` header. */
  trace_id?: string;
  /** Serialized size of the JSON-RPC request, in characters. */
  request_size?: number;
  /** Serialized size of the JSON-RPC response, in characters. */
  response_size?: number;
  /** The JSON-RPC request, only when payload capture is on (after redaction). */
  request_payload?: unknown;
  /** The JSON-RPC response, only when payload capture is on (after redaction). */
  response_payload?: unknown;
}

/** Identity of this SDK, sent with every batch. */
export interface AnalyticsSdkInfo {
  /** Always `@mcp-use/analytics`. */
  name: string;
  /** Package version. */
  version: string;
  /** Always `typescript`. */
  language: "typescript";
  /** Framework the events were recorded from. */
  framework: Framework;
  /** Framework version, when known. */
  framework_version?: string;
  /** Runtime, for example `node/22.11.0`, `bun/1.3.0` or `workerd`. */
  runtime: string;
}

/** A `POST /v1/events` body. */
export interface AnalyticsBatch {
  /** Always `manufact.sdk.v1`. */
  schema: typeof WIRE_SCHEMA;
  /** This SDK. */
  sdk: AnalyticsSdkInfo;
  /** The instrumented server's `serverInfo`, when known. */
  server?: {
    /** Server name. */
    name?: string;
    /** Server version. */
    version?: string;
  };
  /** Up to `maxBatchSize` events. */
  events: AnalyticsEvent[];
}

/** Capture settings the ingest endpoint returns (the dashboard's Analytics capture). */
export interface RemoteConfig {
  /** Whether request and response payloads may be sent. */
  capture_payloads: boolean;
  /** Whether actor names and emails may be sent. */
  identify_actors: boolean;
}

/**
 * The request being recorded, passed to the `identify` and `conversationId`
 * hooks after the handler finished.
 */
export interface AnalyticsRequestContext {
  /** Exact JSON-RPC method. */
  readonly method: string;
  /** JSON-RPC request id. */
  readonly requestId?: string | number;
  /** Request params as the handler received them. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Transport session id, when the transport has one. */
  readonly sessionId?: string;
  /** Verified auth info the framework attached to the request, if any. */
  readonly authInfo?: Readonly<Record<string, unknown>>;
  /** Framework that served the request. */
  readonly framework: Framework;
  /**
   * The framework's own request context: the SDK v1 handler `extra`, the SDK
   * v2 `ServerContext`, or the mcp-use middleware context.
   */
  readonly raw: unknown;
  /** The handler's result, when it returned one. */
  readonly result?: unknown;
  /** The thrown error, when the handler failed. */
  readonly error?: unknown;
  /**
   * Read an HTTP request header (case-insensitive).
   *
   * @param name - Header name.
   * @returns The header value, or undefined on stdio or when absent.
   */
  header(name: string): string | undefined;
}

/** Caller identity returned by the `identify` option. */
export interface ActorIdentity {
  /**
   * Stable user id. Sent only as `sha256(id)` in `actor.token_hash`, replacing
   * the Bearer token hash, so prefer leaving it unset when your callers send a
   * Bearer token: the token hash matches the gateway's actor ids.
   */
  id?: string;
  /**
   * Display name, sent only with an actor (an `id`, or the request's Bearer
   * token) and only when "Identify actors" is on in the dashboard.
   */
  name?: string;
  /**
   * Email, sent only with an actor (an `id`, or the request's Bearer token)
   * and only when "Identify actors" is on in the dashboard.
   */
  email?: string;
}

/** Options for {@link instrument}. Every option is optional. */
export interface AnalyticsOptions {
  /** Server analytics key (`mfi_…`). Defaults to `MANUFACT_ANALYTICS_KEY`. */
  apiKey?: string;
  /**
   * Ingest origin. Defaults to `MANUFACT_ANALYTICS_URL`, then
   * `https://ingest.run.mcp-use.com`.
   */
  endpoint?: string;
  /**
   * Turn recording on or off. Defaults to on unless
   * `MANUFACT_ANALYTICS_DISABLED` is `1`, `true`, `yes` or `on`.
   */
  enabled?: boolean;
  /**
   * `false` never sends payloads from this server. Left unset, payloads follow
   * the dashboard's "Capture payloads" setting; `true` cannot turn capture on
   * when the dashboard setting is off.
   */
  capturePayloads?: boolean;
  /**
   * Last chance to edit or drop an event before it leaves the process. Runs
   * after the default redactor; return `null` to drop the event. Exceptions
   * drop the event, and so does a returned promise that has not settled
   * within 2 seconds.
   */
  redact?: (
    event: AnalyticsEvent
  ) =>
    | AnalyticsEvent
    | null
    | undefined
    | Promise<AnalyticsEvent | null | undefined>;
  /**
   * Override the caller identity. Return `null` to send no actor, `undefined`
   * to keep the default (the Bearer token hash and JWT `name`/`email`). A
   * promise that has not settled within 2 seconds also keeps the default.
   * A `name` or `email` without an `id`, on a request without a Bearer token,
   * sends no actor: the edge keeps names only next to a `token_hash`.
   */
  identify?: (
    ctx: AnalyticsRequestContext
  ) =>
    | ActorIdentity
    | null
    | undefined
    | Promise<ActorIdentity | null | undefined>;
  /**
   * Your own conversation id for the request, which groups requests into one
   * session in the dashboard ahead of transport sessions. A promise that has
   * not settled within 2 seconds sends no conversation id.
   */
  conversationId?: (
    ctx: AnalyticsRequestContext
  ) => string | null | undefined | Promise<string | null | undefined>;
  /**
   * Keep a serverless invocation alive until queued events are sent, for
   * example Cloudflare's `ctx.waitUntil`. Vercel's request context is used
   * automatically when present.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Framework label sent as `sdk.framework`, when detection cannot tell. The
   * label is detected from the server object; `mcp-handler` is recognized
   * only by its default `serverInfo.name`, so a handler that sets its own
   * name is labeled with the SDK underneath (`mcp-sdk-v2`, or `mcp-sdk-v1`
   * for mcp-handler 1.x) unless this is `"mcp-handler"`.
   */
  framework?: Framework;
  /** Log delivery decisions and dropped events to the console. */
  debug?: boolean;
  /** Longest time an event waits in the queue before a flush, in ms. Default 1000. */
  flushIntervalMs?: number;
  /** Events per request to the ingest endpoint. Default 100, at most 500. */
  maxBatchSize?: number;
  /**
   * Events kept in memory waiting to be sent (queued, or waiting for a
   * retry); the oldest are dropped beyond it. A batch that keeps failing is
   * dropped after 8 attempts, about 30 to 60 seconds of backoff, so this
   * bounds memory during short outages rather than buffering a long one.
   * Default 1000.
   */
  maxQueueSize?: number;
}
