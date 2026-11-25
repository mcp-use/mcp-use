/**
 * The subset of the `@mcp-use/client` Events surface (PLAN.md §9.2–§9.5) and
 * of `@mcp-use/events-core/conformance` (§9.1) that
 * `mcp-use client <server> events …` uses.
 *
 * The CLI loads `@mcp-use/client` at run time from the project, next to the
 * CLI or from its private install (`load-client.ts`), so the copy it gets can
 * predate Events. These structural types describe what the commands call;
 * `load.ts` checks that the loaded module really has it before any command
 * runs.
 *
 * @internal
 */

/** Delivery modes of the Events wire (§6). */
export type DeliveryMode = "webhook" | "push" | "poll";

/** One `events/list` entry. */
export interface EventDescriptor {
  name: string;
  description?: string;
  delivery: DeliveryMode[];
  inputSchema: Record<string, unknown>;
  payloadSchema: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

/** One delivered event. */
export interface EventEnvelope {
  eventId: string;
  name: string;
  timestamp: string;
  data: unknown;
  cursor?: string | null;
  _meta?: Record<string, unknown>;
}

/** `events/poll` result. */
export interface PollEventsResult {
  events: EventEnvelope[];
  cursor: string | null;
  truncated: boolean;
  hasMore: boolean;
  nextPollMs?: number;
}

/** `events/subscribe` result. */
export interface SubscribeEventsResult {
  id: string;
  refreshBefore: string | null;
  cursor: string | null;
  truncated: boolean;
  deliveryStatus?: Record<string, unknown>;
}

/** A JSON-RPC error carried by a stream frame or a lane failure. */
export interface WireError {
  code: number;
  message: string;
  data?: Record<string, unknown> | unknown;
}

/** How `streamEvents` ended. */
export interface StreamEventsOutcome {
  end: "closed" | "terminated" | "aborted" | "dead" | "no_active";
  error?: WireError;
  cursor: string | null;
}

/** Lane options (abort and timeout). */
export interface LaneOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** `EventsConnection` (§9.2). */
export interface EventsConnectionLike {
  supportsEvents(): boolean | undefined;
  probe(): Promise<boolean>;
  listAllEvents(options?: LaneOptions): Promise<{ events: EventDescriptor[] }>;
  subscribeEvent(
    params: {
      name: string;
      arguments?: Record<string, unknown>;
      delivery: { mode: "webhook"; url: string; secret: string };
      cursor?: string | null;
      maxAgeMs?: number;
      ttlMs?: number | null;
    },
    options?: LaneOptions
  ): Promise<SubscribeEventsResult>;
  unsubscribeEvent(
    params: {
      name: string;
      arguments?: Record<string, unknown>;
      delivery: { mode: "webhook"; url: string };
    },
    options?: LaneOptions
  ): Promise<void>;
  pollEvents(
    params: {
      name: string;
      arguments?: Record<string, unknown>;
      cursor?: string | null;
      maxAgeMs?: number;
      maxEvents?: number;
    },
    options?: LaneOptions
  ): Promise<PollEventsResult>;
  streamEvents(
    params: {
      name: string;
      arguments?: Record<string, unknown>;
      cursor?: string | null;
      maxAgeMs?: number;
      heartbeatMs?: number;
    },
    handlers: {
      onActive(p: {
        cursor: string | null;
        truncated: boolean;
        heartbeatMs: number;
      }): void;
      onEvent(e: EventEnvelope): void;
      onHeartbeat?(p: { cursor: string | null }): void;
      onError?(p: { error: WireError }): void;
    },
    options?: { signal?: AbortSignal; activeTimeoutMs?: number }
  ): Promise<StreamEventsOutcome>;
}

/** The events lane installed on one connection's transport (§9.2, D80). */
export interface EventsLaneLike {
  wrapTransport(inner: unknown): unknown;
  wrapFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch;
  era(): "legacy" | "modern" | undefined;
}

/** `EventSubscription` from the manager (§9.5). */
export interface EventSubscriptionLike {
  readonly cursor: string | null;
  readonly mode: DeliveryMode;
  readonly id: string;
  close(): Promise<void>;
  cancel(): Promise<void>;
}

/** `EventsManager` (§9.5). */
export interface EventsManagerLike {
  subscribe(
    server: string,
    name: string,
    args: Record<string, unknown>,
    options: {
      mode?: DeliveryMode;
      cursor?: string | null;
      maxAgeMs?: number;
      onGap?: (gap: { cursor: string | null; reason: string }) => void;
      onTerminated?: (t: { kind: string; code: number }) => void;
    }
  ): Promise<EventSubscriptionLike>;
  createWebhookHandler(): (request: Request) => Promise<Response>;
  close(): Promise<void>;
}

/** `EventsManagerInit` fields the CLI passes. */
export interface EventsManagerInitLike {
  connection(server: string): Promise<EventsConnectionLike>;
  onEvent?: (
    event: EventEnvelope,
    info: { server: string; subscription: EventSubscriptionLike }
  ) => void | Promise<void>;
  onEventsError?: (err: Error & { code?: string }) => void;
  receiverUrl?: () => string | undefined;
  dialect?: string;
  prefer?: readonly DeliveryMode[];
  resume?: "auto" | "off";
}

/** The `EventsLaneError` class (JSON-RPC error with decoded kind). */
export interface EventsLaneErrorLike extends Error {
  readonly code: number;
  readonly kind: string | undefined;
  readonly data?: unknown;
  readonly status?: number;
}

/** The Events exports of `@mcp-use/client` the CLI needs. */
export interface ClientEventsModule {
  createSdkClientEventsAdapter(options?: {
    dialect?: { declareExtension?: boolean; sendMcpName?: boolean };
    headers?: Record<string, string>;
  }): EventsLaneLike;
  createEventsConnection(lane: EventsLaneLike): EventsConnectionLike;
  createEventsManager(init: EventsManagerInitLike): EventsManagerLike;
  EventsLaneError: abstract new (...args: never[]) => EventsLaneErrorLike;
}

/** `listenForEvents` from `@mcp-use/client/webhooks`. */
export interface ClientWebhooksModule {
  listenForEvents(options: {
    port?: number;
    tunnel?: boolean;
    handler: (r: Request) => Promise<Response>;
  }): Promise<{ url: string; close(): Promise<void> }>;
}

/** Conformance profiles (§9.1). */
export type ConformanceProfile = "openai" | "sep-3415";

/** `ReceiverHandle` of the conformance runner. */
export interface ReceiverHandle {
  url: string;
  next(
    predicate: (delivery: {
      headers: Headers;
      body: Uint8Array;
      json: unknown;
    }) => boolean,
    timeoutMs: number
  ): Promise<{ headers: Headers; body: Uint8Array; json: unknown }>;
  close(): Promise<void>;
}

/** `ConformanceReport` (§9.1). */
export interface ConformanceReport {
  target: string;
  startedAt: string;
  dialects: string[];
  results: Array<{
    id: string;
    dialect: string;
    level: string;
    outcome: "pass" | "fail" | "skip";
    detail?: string;
    ms: number;
  }>;
  summary: {
    mustFailed: number;
    shouldFailed: number;
    passed: number;
    skipped: number;
  };
}

/** `@mcp-use/events-core/conformance` (§9.1). */
export interface ConformanceModule {
  runConformance(o: {
    url: string | URL;
    dialects: readonly ConformanceProfile[];
    headers?: Record<string, string>;
    mcpName?: "lenient" | "strict";
    receiver?: ReceiverHandle;
    only?: readonly string[];
  }): Promise<ConformanceReport>;
  toJUnit(r: ConformanceReport): string;
}
