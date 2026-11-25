/**
 * `EventsConfig` (PLAN.md §7.3) and the Appendix C defaults as named
 * constants. Type-only plus constants; edge-safe.
 *
 * @packageDocumentation
 */

import type {
  EventsSignals,
  KnownClientRule,
  ProfileAxes,
} from "@mcp-use/events-core";
import type { OAuthAuth } from "../context.js";
import type { McpUseStorage } from "../storage/types.js";
import type { EventsLogRecord } from "./log-records.js";
import type { DialectId, Duration, WebhookSender } from "./types.js";

/** MCP Events options (`ServerConfig.events`). None are needed under `mcp-use dev` or on Manufact Cloud. */
export interface EventsConfig<TUser = never> {
  /** User binding for Events only: overrides `ServerConfig.storage` and `MCP_USE_STORAGE_URL` (§8.5). */
  storage?: McpUseStorage;
  /** Override the runtime-selected sender (§8.15). */
  sender?: WebhookSender;
  /** Record-sealing keyring; the first key encrypts, all decrypt (D22). User binding only. */
  secret?: string | readonly string[];
  /** Stable environment identity (D24). User binding only. */
  namespace?: string;
  /** Principal derivation. Default: `provider.principal(authInfo)`, else the token's issuer and subject joined by `|` (D13). */
  principal?: (auth: OAuthAuth<TUser>) => string | null | undefined;
  /** `"auto"` (default): openai-profile anonymous webhooks iff no OAuth is configured (D13b). */
  anonymous?: "auto" | "reject" | "openai";
  /** Webhook TTL bounds (D21). Defaults: default 24h, min 5m, max 7d, allowNoExpiry false. */
  ttl?: {
    /** Default TTL, optionally per dialect. */
    default?: Duration | Partial<Record<DialectId, Duration>>;
    /** Minimum TTL (requests below are clamped up). */
    min?: Duration;
    /** Maximum TTL. */
    max?: Duration;
    /** Allow subscriptions without expiry (durable storage only). */
    allowNoExpiry?: boolean;
  };
  /** Delivery retry policy (Appendix C). */
  retry?: {
    /** Default `[0, "30s", "2m", "5m", "7m"]`, ±20 % jitter. */
    delays?: readonly Duration[];
    /** Per-attempt total timeout. Default `"10s"`. */
    timeout?: Duration;
    /** Retry window. Default `"15m"`. */
    window?: Duration;
    /** Jobs older than this at claim are dead-lettered `stale`. Default `"24h"`. */
    maxAge?: Duration;
    /** Dead-letter retention. Default `"7d"`; 0 disables dead letters. */
    deadLetterTtl?: Duration;
  };
  /** Webhook callback rules. */
  webhook?: {
    /** Callback URL prefixes exempt from https and public-address rules (still verified). */
    trustedOrigins?: readonly (string | RegExp)[];
    /** Pre-verified callback URL patterns. */
    allowlist?: readonly (string | RegExp)[];
    /** Verification options (D29). */
    verification?: {
      /** Default `"5s"`. */
      timeout?: Duration;
      /** Default `"24h"`. */
      cacheTtl?: Duration;
      /** Default `"warn"`. */
      antiReflection?: "warn" | "reject";
    };
  };
  /** CONNECT proxy for verification and deliveries (D65). `false` disables a platform default. */
  egressProxy?: string | false;
  /** Server-wide replay default (D50): `{ maxAge: "1h", maxEvents: 1000 }`. */
  replay?: false | { maxAge?: Duration; maxEvents?: number };
  /** Poll mode options. */
  poll?: {
    /** Default true. */
    enabled?: boolean;
    /** Default `"10s"`. */
    interval?: Duration;
    /** Default page size, 100. */
    maxEvents?: number;
    /** Page size cap, 1000. */
    maxEventsCap?: number;
    /** Log entries scanned per request, 1000. */
    scanBudget?: number;
    /** Polls per (principal, name) per minute per instance, 120. */
    perPrincipalPerMinute?: number;
    /** Anonymous polls per (address, name) per minute per instance, 120. */
    anonymousPerAddressPerMinute?: number;
  };
  /** Push mode options. */
  push?: {
    /** `"auto"` (default), true or false. */
    enabled?: "auto" | boolean;
    /** Heartbeat grant bounds: default 30s, min 5s, max 55s. */
    heartbeat?: { default?: Duration; min?: Duration; max?: Duration };
    /** Graceful rotation. Default by runtime. null = unlimited. */
    maxDuration?: Duration | null;
    /** Tail polling interval when the storage has no wake signal. */
    tailInterval?: Duration;
    /** Per-stream backlog bound, 1 MiB. */
    maxBacklogBytes?: number;
  };
  /** Direct leases (D58). */
  leases?: {
    /** Default `max("5m", 3 × poll interval)`. */
    ttl?: Duration;
  };
  /** Quotas and limits (Appendix C). */
  limits?: {
    /** 100. */
    subscriptionsPerPrincipal?: number;
    /** 20. */
    anonymousSubscriptionsPerUrl?: number;
    /** 10,000. */
    anonymousSubscriptionsPerNamespace?: number;
    /** 100,000 per namespace. */
    maxSubscriptions?: number;
    /** 10 per callback host per instance. */
    perHostConcurrency?: number;
    /** Per-host overrides (D48). */
    hosts?: Record<string, { concurrency?: number }>;
    /** 4. */
    verificationsInFlightPerHost?: number;
    /** 10. */
    verificationsPerPrincipalHostPerMinute?: number;
    /** 600. */
    verificationsPerHostPerMinute?: number;
    /** 60 (loop guard, D46). */
    deliveriesPerSubscriptionPerMinute?: number;
    /** 20 per instance. */
    streamsPerPrincipal?: number;
    /** 20 per instance. */
    anonymousStreamsPerAddress?: number;
    /** 1000 per instance. */
    maxStreams?: number;
    /** 1000 unsettled deliveries. */
    maxPendingPerSubscription?: number;
    /** Suspension policy. */
    suspension?: {
      /** 0.95. */
      failureRate?: number;
      /** `"60m"`. */
      window?: Duration;
      /** 100. */
      minAttempts?: number;
      /** `"7d"`. */
      dropNoExpiryAfter?: Duration;
    };
    /** Circuit breaker per host. */
    breaker?: {
      /** 20 consecutive failures. */
      failures?: number;
      /** `["30s", "2m", "5m"]`. */
      openFor?: readonly Duration[];
    };
  };
  /** Dialect compatibility. */
  compatibility?: {
    /** Advertise the top-level key and allow the openai profile. Default true. */
    openai?: boolean;
    /** Force a preset. */
    dialect?: "auto" | DialectId;
    /** Modern requests with no stronger signal. Default `"openai"`. */
    ambiguous?: DialectId;
    /** Missing `Mcp-Name` on SEP requests. Default `"lenient"` (D9). */
    mcpName?: "lenient" | "strict";
    /** Rows applied before the built-in table (D54). */
    knownClients?: readonly KnownClientRule[];
    /** Axis overrides applied after preset resolution. */
    axes?: Partial<ProfileAxes>;
    /** Custom resolution hook. */
    resolveDialect?: (
      signals: EventsSignals
    ) =>
      | DialectId
      | { preset: DialectId; overrides?: Partial<ProfileAxes> }
      | undefined;
  };
  /** Scope handling (D39). */
  scopes?: {
    /** Add event scopes to every tool's securitySchemes. Default false. */
    attachToTools?: boolean;
  };
  /** `"auto"` (default): pump in long-lived processes (D19). `"off"`: call `server.events.process()` yourself. */
  worker?: "auto" | "off";
  /** Explicit waitUntil when the runtime exposes none. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Bearer list for the internal admin routes (D41). */
  admin?: {
    /** Default `MCP_USE_EVENTS_ADMIN_SECRET`. */
    secret?: string | readonly string[];
  };
  /** Bearer list for the tick route. */
  tick?: {
    /** Default `MCP_USE_EVENTS_TICK_SECRET ?? CRON_SECRET`. */
    secret?: string | readonly string[];
  };
  /** `"text"` (default) or `"json"` (one record per stdout line). */
  logFormat?: "text" | "json";
  /** Structured log hook (§14). */
  onLog?: (record: EventsLogRecord) => void;
  /** Memory storage outside dev and test. */
  unsafeAllowEphemeral?: boolean;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Appendix C defaults, in ms and counts. The engine reads defaults only from here. */
export const EVENTS_DEFAULTS = {
  /** Retry delays (relative ms). */
  retryDelaysMs: [0, 30 * SECOND, 2 * MINUTE, 5 * MINUTE, 7 * MINUTE],
  /** Jitter fraction. */
  retryJitter: 0.2,
  /** Retry window. */
  retryWindowMs: 15 * MINUTE,
  /** Per-attempt timeout. */
  deliveryTimeoutMs: 10 * SECOND,
  /** Connect timeout. */
  connectTimeoutMs: 5 * SECOND,
  /** Response bytes read. */
  responseReadBytes: 4096,
  /** Max job age. */
  retryMaxAgeMs: DAY,
  /** Dead-letter TTL. */
  deadLetterTtlMs: 7 * DAY,
  /** Verification timeout. */
  verificationTimeoutMs: 5 * SECOND,
  /** Verification cache. */
  verificationCacheTtlMs: DAY,
  /** Verification failure cache. */
  verificationFailureTtlMs: MINUTE,
  /** TTL default. */
  ttlDefaultMs: DAY,
  /** TTL min. */
  ttlMinMs: 5 * MINUTE,
  /** TTL max. */
  ttlMaxMs: 7 * DAY,
  /** Memory storage TTL cap. */
  memoryTtlCapMs: HOUR,
  /** Quotas. */
  subscriptionsPerPrincipal: 100,
  anonymousSubscriptionsPerUrl: 20,
  anonymousSubscriptionsPerNamespace: 10_000,
  maxSubscriptions: 100_000,
  perHostConcurrency: 10,
  perSubscriptionConcurrency: 4,
  verificationsInFlightPerHost: 4,
  verificationsPerPrincipalHostPerMinute: 10,
  verificationsPerHostPerMinute: 600,
  deliveriesPerSubscriptionPerMinute: 60,
  maxPendingPerSubscription: 1000,
  replayPacingUnsettled: 50,
  /** Suspension. */
  suspensionFailureRate: 0.95,
  suspensionWindowMs: 60 * MINUTE,
  suspensionMinAttempts: 100,
  suspensionParkMs: 5 * MINUTE,
  dropNoExpiryAfterMs: 7 * DAY,
  /** Breaker. */
  breakerFailures: 20,
  breakerOpenForMs: [30 * SECOND, 2 * MINUTE, 5 * MINUTE],
  /** Secret rotation grace. */
  rotationGraceMs: 10 * MINUTE,
  /** Emit dedupe window. */
  emitDedupeMs: DAY,
  /** Envelope cap. */
  maxEnvelopeBytes: 262_144,
  /** Attempt log length. */
  attemptLogMax: 20,
  /** Replay window. */
  replayMaxAgeMs: HOUR,
  replayMaxEvents: 1000,
  replayMaxAgeBoundsMs: [MINUTE, 30 * DAY],
  replayMaxEventsBounds: [1, 100_000],
  replayHardCapMin: 10_000,
  /** Non-replayable retention after dispatch. */
  nonReplayableRetentionMs: 2 * MINUTE,
  /** Poll. */
  pollIntervalMs: 10_000,
  pollIntervalMinMs: 1000,
  pollMaxEvents: 100,
  pollMaxEventsCap: 1000,
  pollScanBudget: 1000,
  pollPerPrincipalPerMinute: 120,
  /** Push. */
  heartbeatDefaultMs: 30 * SECOND,
  heartbeatMinMs: 5 * SECOND,
  heartbeatMaxMs: 55 * SECOND,
  pushMaxDurationLongLivedMs: HOUR,
  pushMaxDurationServerlessMs: 240 * SECOND,
  pushMaxDurationWorkersMs: 120 * SECOND,
  tailSharedMs: SECOND,
  tailPerStreamMs: 3 * SECOND,
  tailSignalSafetyMs: 30 * SECOND,
  maxBacklogBytes: 1_048_576,
  streamsPerPrincipal: 20,
  maxStreams: 1000,
  reauthorizeMs: 15 * MINUTE,
  /** Leases. */
  leaseTtlMinMs: 5 * MINUTE,
  recordRetentionAfterExpiryMs: 7 * DAY,
  /** Dispatcher and jobs. */
  dispatcherBatchEntries: 100,
  dispatcherPageSubscriptions: 100,
  dispatcherBudgetMs: 25 * SECOND,
  dispatcherLeaseMs: 30 * SECOND,
  jobLeaseMs: 30 * SECOND,
  jobSafetyTtlMs: 7 * DAY,
  pumpScanMs: 30 * SECOND,
  pumpIdleScanMs: 60 * SECOND,
  tickBudgetMs: 25 * SECOND,
  sweeperLeaseMs: 55 * SECOND,
  logTrimEveryMs: 5 * MINUTE,
  catalogDormancyMs: DAY,
  /** Wake guarantee. */
  wakeOverdueMs: 60 * SECOND,
  wakeMaxBackoffMs: 5 * MINUTE,
  /** Decommission. */
  decommissionDeadlineMs: 60 * SECOND,
  decommissionDeadlineMaxMs: 120 * SECOND,
  /** Receiver. */
  receiverToleranceSec: 300,
} as const;
