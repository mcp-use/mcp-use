/**
 * The internal `EventsBackend` engine/state boundary (PLAN.md §8.6). Not
 * exported. Implemented once as `storageBackend` (WP-20).
 *
 * @internal
 */

import type { ProfileAxes } from "@mcp-use/events-core";
import type { DeliveryErrorCategory } from "@mcp-use/events-core";
import type {
  DialectId,
  EventsHealth,
  SubscriptionView,
  TickReport,
} from "../types.js";
import type { Clock } from "./clock.js";
import type { EventsRegistry } from "./registry.js";
import type {
  DirectLease,
  EventsJob,
  FanoutState,
  LogTarget,
  LogValue,
  SubscriptionRecord,
} from "./records.js";

/** One item of an atomic emit append. */
export interface AppendItem {
  name: string;
  value: LogValue;
  /** Emit dedupe key suffix `h(eventId ‖ JCS(to))`, or null for control entries. */
  dedupeKey: string | null;
  to?: LogTarget;
}

/** Identity of a webhook subscription. */
export interface SubscriptionKey {
  principal: string;
  url: string;
  name: string;
  args: Record<string, unknown>;
}

/** Per-call context the engine passes to the backend. */
export interface BackendCallContext {
  now: number;
  /** Structured log sink. */
  log?: (record: import("../log-records.js").EventsLogRecord) => void;
}

/** Input of `subscribe`. */
export interface SubscribeInput {
  key: SubscriptionKey;
  /** `whsec_…`, write-only. */
  secret: string;
  grantTtlMs: number | null;
  profile: {
    preset: DialectId;
    revision: number;
    axes: ProfileAxes;
    via: string;
  };
  partition: string | null;
  meta: SubscriptionRecord["meta"];
  cursor: string | null;
  maxAgeMs?: number;
}

/** Result of `subscribe`. */
export interface SubscriptionGrant {
  id: string;
  created: boolean;
  refreshBefore: string | null;
  cursor: string | null;
  truncated: boolean;
  deliveryStatus?: {
    active: boolean;
    lastDeliveryAt: string | null;
    lastError: DeliveryErrorCategory | null;
    throttled?: boolean;
    retryAfterMs?: number;
  };
}

/** Internal revoke filter. */
export interface RevokeFilterInternal {
  principal?: string;
  subscriptionId?: string;
  name?: string;
  reason?: string;
}

/** A deliver job draft created by the dispatcher. */
export interface DeliverDraft {
  epoch: string;
  seq: number;
  eventId: string;
  body: string;
}

/** Input of `touchLease`. */
export interface LeaseInput {
  id: string;
  name: string;
  principal: string;
  args: Record<string, unknown>;
  mode: "poll" | "push";
  ttlMs: number;
}

/** Engine dependencies the backend calls back into while processing jobs. */
export interface ProcessDeps {
  registry: EventsRegistry;
  clock: Clock;
  /** Sends one webhook POST (the selected sender). */
  send: import("../types.js").WebhookSender["send"];
  log: (record: import("../log-records.js").EventsLogRecord) => void;
  /** This instance's lease owner id. */
  owner: string;
}

/** The engine/state boundary. */
export interface EventsBackend {
  /** `"storage:redis"` | `"storage:upstash"` | … */
  readonly kind: string;
  readonly capabilities: {
    durable: boolean;
    shared: boolean;
    maxTtlMs: number;
    allowNoExpiry: boolean;
    maxPayloadBytes: number;
    signal: boolean;
    tail: "shared" | "perStream";
  };
  meta(): Promise<{ layout: number; cursorKey: Uint8Array }>;
  append(
    items: readonly AppendItem[]
  ): Promise<
    Array<
      | { duplicate: false; seq: number; epoch: string }
      | { duplicate: true; seq: number | null }
    >
  >;
  readLog(
    name: string,
    after: number | null,
    o: { limit: number }
  ): Promise<{
    entries: Array<{ seq: number; value: LogValue }>;
    epoch: string | null;
    first: number;
    head: number;
  }>;
  trimLog(name: string, before: number): Promise<number>;
  subscribe(
    input: SubscribeInput,
    ctx: BackendCallContext
  ): Promise<SubscriptionGrant>;
  unsubscribe(
    key: SubscriptionKey,
    ctx: BackendCallContext
  ): Promise<{ removed: SubscriptionView | null }>;
  revoke(
    filter: RevokeFilterInternal,
    ctx: BackendCallContext
  ): Promise<{ removed: SubscriptionView[] }>;
  isRevoked(key: SubscriptionKey): Promise<boolean>;
  watermark(subscriptionId: string): Promise<string | null>;
  claimFanout(
    name: string,
    owner: string
  ): Promise<{ state: FanoutState; version: string } | null>;
  commitFanout(
    name: string,
    state: FanoutState,
    version: string
  ): Promise<boolean>;
  find(q: {
    name: string;
    group: "unpartitioned" | "p:*" | { partition: string };
    after?: string;
    limit: number;
  }): Promise<{ items: SubscriptionRecord[]; next?: string }>;
  createDeliveries(
    sub: SubscriptionRecord,
    items: readonly DeliverDraft[]
  ): Promise<void>;
  touchLease(
    input: LeaseInput
  ): Promise<{ created: boolean; lease: DirectLease }>;
  expiredLeases(limit: number): Promise<DirectLease[]>;
  process(
    ref: { jobId: string } | "due",
    deps: ProcessDeps,
    o?: { kinds?: readonly EventsJob["kind"][]; budgetMs?: number }
  ): Promise<TickReport>;
  sweep(deps: ProcessDeps): Promise<{ expired: number }>;
  health(): Promise<EventsHealth>;
  close(deadlineMs: number): Promise<void>;
}
