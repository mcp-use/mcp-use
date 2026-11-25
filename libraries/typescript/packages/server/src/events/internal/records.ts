/**
 * Layout-1 record and job shapes (PLAN.md Appendix B). Internal; additive
 * changes only (D67). Unknown fields survive every read-modify-write.
 *
 * @internal
 */

import type {
  DeliveryErrorCategory,
  EventsErrorKind,
  ProfileAxes,
} from "@mcp-use/events-core";
import type { DeliveryMode, DialectId } from "../types.js";

/** `ev:{ns}:meta`: plaintext envelope whose `cursorKey` alone is sealed. */
export interface NamespaceMeta {
  v: 1;
  layout: 1;
  createdAt: number;
  /** Sealed; 32 random bytes. AD = key + `#cursorKey`. */
  cursorKey: string;
}

/** `ev:{ns}:closed`. */
export interface ClosedRecord {
  at: number;
  reason: string;
}

/** `ev:{ns}:catalog`. */
export interface CatalogRecord {
  v: 1;
  hash: string;
  writtenAt: number;
  deployment?: string;
  events: Record<
    string,
    {
      schemaHash: string;
      replay: boolean;
      hooks: { onSubscribe: boolean; onUnsubscribe: boolean };
    }
  >;
}

/** Delivery targeting of a log entry. */
export interface LogTarget {
  principals?: string[];
  subscriptionId?: string;
}

/** One log value per seq: an event (`k:"e"`) or a control entry (`k:"t"`). */
export type LogValue =
  | {
      v: 1;
      k: "e";
      /** Raw eventId. */
      id: string;
      /** ISO 8601 occurrence time. */
      ts: string;
      /** Append ms. */
      at: number;
      data: unknown;
      meta?: Record<string, unknown>;
      partition: string | null;
      to?: LogTarget;
      test?: true;
    }
  | {
      v: 1;
      k: "t";
      at: number;
      to: LogTarget & { all?: true };
      error: {
        kind: EventsErrorKind;
        message: string;
        data?: Record<string, unknown>;
      };
    };

/** `ev:{ns}:fanout:{n}` (CAS). */
export interface FanoutState {
  v: 1;
  epoch: string | null;
  through: number;
  batch?: { toSeq: number; group: string; after?: string };
  lostThrough?: number;
  updatedAt: number;
}

/** Stored projection of `EventsSignals`. */
export interface SubscriptionRecordMeta {
  era: "legacy" | "modern";
  clientName?: string;
  clientVersion?: string;
  userAgent?: string;
  declared: boolean;
  mcpName: "present" | "missing";
  mcpMethod?: boolean;
  deployment?: string;
  anonymous?: boolean;
  dev?: boolean;
}

/** Stored profile pin. */
export interface StoredProfilePin {
  preset: string;
  revision: number;
  axes: ProfileAxes;
  via: string;
}

/** `ev:{ns}:sub:{id}`. */
export interface SubscriptionRecord {
  v: 1;
  id: string;
  principal: string;
  name: string;
  /** Raw normalized arguments (identity, D6). */
  args: Record<string, unknown>;
  argsHash: string;
  partition: string | null;
  url: string;
  secret: string;
  previousSecret?: { secret: string; expiresAt: number };
  profile: StoredProfilePin;
  createdAt: number;
  refreshedAt: number;
  expiresAt: number | null;
  verifiedVia: "challenge" | "allowlist" | "trusted-origin" | "well-known";
  catalogHash: string;
  /** Null while a create is in progress. */
  start: { epoch: string; seq: number } | null;
  meta: SubscriptionRecordMeta;
}

/** `ev:{ns}:status:{id}`. */
export interface SubscriptionStatus {
  v: 1;
  active: boolean;
  suspendedAt?: number;
  suspendedExpiresAt?: number | null;
  lastDeliveryAt: number | null;
  lastError: DeliveryErrorCategory | null;
  failedSince?: number;
  gapPending: boolean;
  throttle?: { windowStart: number; count: number };
  /** 60 one-minute buckets. */
  buckets: Array<[minute: number, attempts: number, failures: number]>;
  abandoned: number;
}

/** `ev:{ns}:lease:{did}`. */
export interface DirectLease {
  v: 1;
  id: string;
  name: string;
  principal: string;
  args: Record<string, unknown>;
  modes: Array<"poll" | "push">;
  createdAt: number;
  touchedAt: number;
  expiresAt: number;
}

/** Snapshot carried by hook jobs. */
export interface SubscriptionInfoSnapshot {
  id: string;
  name: string;
  args: Record<string, unknown>;
  principal: string;
  dialect: DialectId;
  mode: DeliveryMode;
  callbackOrigin: string | null;
  expiresAt: number | null;
}

/** Common job fields. */
export interface JobBase {
  v: 1;
  id: string;
  createdAt: number;
  lease?: { owner: string; until: number };
}

/** Retry schedule fields. */
export interface Scheduled {
  attempt: number;
  /** Relative, jittered at creation, Σ ≤ retry.window. */
  delays: number[];
  firstAttemptAt: number | null;
  lastAttemptAt: number | null;
  pausedMs: number;
  nextAt: number;
  /** createdAt + retry.maxAge. */
  maxAgeAt: number;
}

/** Deliver job. */
export type DeliverJob = JobBase &
  Scheduled & {
    kind: "deliver";
    subscriptionId: string;
    epoch: string;
    seq: number;
    eventId: string;
    webhookId: string;
    /** Fixed bytes incl. cursor. */
    body: string;
    bodyBytes: number;
    /** D74: bypasses inflight. */
    redelivery?: true;
  };

/** Control job. */
export type ControlJob = JobBase &
  Scheduled & {
    kind: "control";
    subscriptionId: string;
    type: "gap" | "terminated";
    webhookId: string;
    body: string;
    /** terminated: record already gone. */
    target?: { url: string; secret: string; previousSecret?: string };
  };

/** Hook job. */
export type HookJob = JobBase &
  Scheduled & {
    kind: "hook";
    reason: "unsubscribed" | "expired" | "revoked" | "terminated" | "closed";
    subscription: SubscriptionInfoSnapshot;
  };

/** Replay job. */
export type ReplayJob = JobBase & {
  kind: "replay";
  subscriptionId: string;
  epoch: string;
  nextSeq: number;
  toSeq: number;
};

/** Every job kind. Unknown kinds are never claimed. */
export type EventsJob = DeliverJob | ControlJob | HookJob | ReplayJob;

/** `ev:{ns}:dead:{jobId}`. */
export interface DeadLetter {
  v: 1;
  job: EventsJob;
  reason: "exhausted" | "stale" | "http_410" | "http_413";
  at: number;
}

/** One entry of `log ev:{ns}:attempts:{id}`. */
export interface AttemptRecord {
  at: number;
  kind: "event" | "verification" | "gap" | "terminated";
  eventId?: string;
  webhookId: string;
  attempt: number;
  outcome: "ack" | DeliveryErrorCategory | "gone" | "too_large" | "stale";
  /** Admin only, never on the wire. */
  httpStatus?: number;
  ms: number;
  nextAt?: number;
}

/** `ev:{ns}:tomb:{id}`. */
export interface Tombstone {
  reason: string;
}
