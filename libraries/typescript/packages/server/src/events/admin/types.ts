/**
 * The one definition of every admin type (PLAN.md §12.3.3). §7.2 shows the
 * same types. Edge-safe; no event definitions, no app code.
 *
 * @packageDocumentation
 */

import type { DeliveryErrorCategory } from "@mcp-use/events-core";
import type { McpUseStorage } from "../../storage/types.js";
import type { AttemptRecord, CatalogRecord } from "../internal/records.js";
import type { EventsLogRecord } from "../log-records.js";
import type { DeliveryMode, SubscriptionView, TickReport } from "../types.js";

export type { AttemptRecord, CatalogRecord } from "../internal/records.js";
export type { TickReport } from "../types.js";

/** A store binding the admin library opens. */
export interface EventsBinding {
  /** Already prefixed (McpUseStorage `prefix`). */
  storage: McpUseStorage;
  /** Environment identity. */
  namespace: string;
  /** Keyring. Omit for key-less operations (status, nextWakeAt). */
  secret?: string | readonly string[];
}

/** Key-less namespace status. */
export interface EventsStatus {
  /** Layout, or null for an empty namespace. */
  layout: 1 | null;
  /** Whether the namespace is decommissioned. */
  closed: boolean;
  /** Members of `idx due`. */
  due: number;
  /** Members of `idx fanout-due`. */
  fanoutDue: number;
  /** Age of the oldest due entry. */
  oldestDueAgeMs: number | null;
  /** ISO 8601 or null (D63). */
  nextWakeAt: string | null;
  /** Dead letters retained. */
  deadLetters: number;
  /** Webhook subscriptions. */
  subscriptions: number;
  /** Direct leases. */
  leases: number;
}

/** An abandoned deliver or control job; the body is never returned. */
export interface DeadLetterView {
  /** The abandoned job id (`d.…`, `c.{id}.gap`, `c.{id}.terminated`). */
  id: string;
  /** Job kind. */
  kind: "deliver" | "control";
  /** Control type. */
  type?: "gap" | "terminated";
  /** Subscription id. */
  subscriptionId: string;
  /** Event name, when known. */
  name: string | null;
  /** Event id (deliver jobs). */
  eventId: string | null;
  /** The `webhook-id` reused on redelivery. */
  webhookId: string;
  /** Why it was abandoned. */
  reason: "exhausted" | "stale" | "http_410" | "http_413";
  /** ISO 8601. */
  abandonedAt: string;
  /** Attempts made. */
  attempts: number;
  /** Last error. */
  lastError: DeliveryErrorCategory | null;
  /** Callback origin. */
  callbackOrigin: string;
  /** Body size. */
  bodyBytes: number;
}

/** Admin query for subscriptions. */
export interface AdminSubscriptionQuery {
  /** Event name. */
  name?: string;
  /** Principal. */
  principal?: string;
  /** Delivery mode. */
  mode?: DeliveryMode;
  /** Status. */
  status?: "active" | "suspended";
  /** Page cursor. */
  after?: string;
  /** Page size. */
  limit?: number;
}

/** The admin library handle (D66). */
export interface EventsAdmin {
  /** The namespace. */
  readonly namespace: string;
  /** Key-less. */
  status(): Promise<EventsStatus>;
  /** Key-less: min(first score of idx due, first score of idx fanout-due), or null. */
  nextWakeAt(): Promise<Date | null>;
  /** Keyring required from here on. */
  catalog(): Promise<CatalogRecord | null>;
  /** Webhook subscriptions. */
  subscriptions(
    q?: AdminSubscriptionQuery
  ): Promise<{ items: SubscriptionView[]; next?: string }>;
  /** One subscription with its attempt log. */
  subscription(
    id: string
  ): Promise<(SubscriptionView & { attempts: AttemptRecord[] }) | null>;
  /** Direct leases (mode push or poll). */
  leases(q?: {
    name?: string;
    principal?: string;
    after?: string;
    limit?: number;
  }): Promise<{ items: SubscriptionView[]; next?: string }>;
  /** Dead letters. */
  deadLetters(q?: {
    subscriptionId?: string;
    after?: string;
    limit?: number;
  }): Promise<{ items: DeadLetterView[]; next?: string }>;
  /** Re-enqueue with the same body and webhook-id; bypasses inflight (D74). */
  redeliver(deadLetterId: string): Promise<{ jobId: string }>;
  /** Revoke (D37, D56). At least one of principal or subscriptionId. */
  revoke(filter: {
    principal?: string;
    name?: string;
    subscriptionId?: string;
    reason?: string;
  }): Promise<{ removed: number }>;
  /** Re-seal everything with the first key of the keyring (D22). */
  rekey(options?: {
    budgetMs?: number;
  }): Promise<{ rewritten: number; remaining: number }>;
  /** Delete the namespace and leave `closed` for 7 d. */
  purge(): Promise<{ deletedKeys: number }>;
}

/** Options of {@link PingTick}. */
export interface PingTickOptions {
  /** The tick route URL. */
  url: string;
  /** An accepted bearer. */
  secret: string;
  /** Public `Host` header to send. */
  host?: string;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Fetch implementation. */
  fetch?: typeof fetch;
}

/** Options of {@link RunWakeLoop}. */
export interface RunWakeLoopOptions {
  /** The namespace's admin handle. */
  admin: EventsAdmin;
  /** Tick target. */
  tick: { url: string; secret: string; host?: string };
  /** Default 60,000. */
  overdueMs?: number;
  /** Default 300,000. */
  maxBackoffMs?: number;
  /** Stops the loop. */
  signal: AbortSignal;
  /** Log sink. */
  onLog?: (r: EventsLogRecord) => void;
}

/** Signature of `pingTick`. */
export type PingTick = (o: PingTickOptions) => Promise<TickReport>;
/** Signature of `runWakeLoop` (the wake guarantee reference implementation, §12.3.4). */
export type RunWakeLoop = (o: RunWakeLoopOptions) => Promise<void>;
