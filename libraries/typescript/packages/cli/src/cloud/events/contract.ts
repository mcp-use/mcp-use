/**
 * Manufact Cloud events API contract (PLAN.md §11.4). Every path is under
 * `/servers/{id}/events` and takes `branch=<git branch>` or
 * `production=true` (POST: in the body); omitted means production for reads
 * and is rejected for writes. Locked by `contracts/events/cloud-api.json`.
 *
 * The CLI does not depend on `mcp-use` (CODE-B1), so the shared shapes are
 * restated structurally here; `tests/cloud/events-contract.test.ts` checks
 * the fixtures against both.
 */

/** Delivery mode. */
export type CloudDeliveryMode = "webhook" | "poll" | "push";

/** `SubscriptionView` (mcp-use §7.2). */
export interface CloudSubscriptionView {
  id: string;
  name: string;
  args: Record<string, unknown>;
  principal: string;
  mode: CloudDeliveryMode;
  profile: { preset: string; revision: number; via: string };
  era: "legacy" | "modern";
  partition: string | null;
  callbackOrigin: string | null;
  createdAt: string;
  refreshedAt: string;
  expiresAt: string | null;
  status: "active" | "suspended";
  watermark: string | null;
  lastDeliveryAt?: string;
  lastError?: string;
  clientName?: string;
}

/** `AttemptRecord` (Appendix B). */
export interface CloudAttemptRecord {
  at: number;
  kind: "event" | "verification" | "gap" | "terminated";
  eventId?: string;
  webhookId: string;
  attempt: number;
  outcome: string;
  httpStatus?: number;
  ms: number;
  nextAt?: number;
}

/** `DeadLetterView` (§12.3.3). */
export interface CloudDeadLetterView {
  id: string;
  kind: "deliver" | "control";
  type?: "gap" | "terminated";
  subscriptionId: string;
  name: string | null;
  eventId: string | null;
  webhookId: string;
  reason: "exhausted" | "stale" | "http_410" | "http_413";
  abandonedAt: string;
  attempts: number;
  lastError: string | null;
  callbackOrigin: string;
  bodyBytes: number;
}

/** `CatalogRecord` (Appendix B). */
export interface CloudCatalogRecord {
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

/** `GET /status`: `admin.status()` plus platform fields; null fields under the user binding. */
export interface CloudEventsStatus {
  layout: 1 | null;
  closed: boolean | null;
  due: number | null;
  fanoutDue: number | null;
  oldestDueAgeMs: number | null;
  nextWakeAt: string | null;
  deadLetters: number | null;
  subscriptions: number | null;
  leases: number | null;
  binding: "platform" | "user";
  namespaceHash: string;
  updatedAt: string;
  message?: string;
}

/** One line of the catalog diff. */
export interface CatalogDiffLine {
  name: string;
  change: "added" | "removed" | "changed" | "unchanged";
}

/** `GET /catalog`. `manifest` is the build manifest's `EventsCatalogSnapshot` (§11.5). */
export interface CloudEventsCatalog {
  manifest: Record<string, unknown> | null;
  active: CloudCatalogRecord | null;
  missing: Record<string, string>;
  diff: CatalogDiffLine[];
}

/** One delivery row from ingested logs (P8). */
export interface DeliveryRow {
  at: string;
  name: string;
  subscription: string;
  attempt: number;
  outcome: string;
  ms: number;
  nextRetryMs?: number;
  deadLetterId?: string;
}

/** A page. */
export interface CloudPage<T> {
  items: T[];
  next?: string;
}

/** One Cloud events operation. */
export interface CloudEventsOperation {
  id: string;
  method: "GET" | "POST";
  /** Relative to `/servers/{id}/events`. */
  path: string;
  query?: readonly string[];
  body?: readonly string[];
  /** Fixture file under `tests/fixtures/events/` holding a sample response. */
  fixture: string;
}

/** The Cloud events operations. */
export const CLOUD_EVENTS_OPERATIONS: readonly CloudEventsOperation[] = [
  { id: "status", method: "GET", path: "/status", fixture: "status.json" },
  { id: "catalog", method: "GET", path: "/catalog", fixture: "catalog.json" },
  {
    id: "subscriptions",
    method: "GET",
    path: "/subscriptions",
    query: ["event", "principal", "status", "mode", "after", "limit"],
    fixture: "subscriptions.json",
  },
  {
    id: "subscription",
    method: "GET",
    path: "/subscriptions/{subId}",
    fixture: "subscription.json",
  },
  {
    id: "deliveries",
    method: "GET",
    path: "/deliveries",
    query: ["status", "subscription", "after", "limit"],
    fixture: "deliveries.json",
  },
  {
    id: "deadLetters",
    method: "GET",
    path: "/dead-letters",
    query: ["subscription", "after", "limit"],
    fixture: "dead-letters.json",
  },
  {
    id: "redeliver",
    method: "POST",
    path: "/dead-letters/{deadLetterId}:redeliver",
    fixture: "redeliver.json",
  },
  {
    id: "revoke",
    method: "POST",
    path: "/revoke",
    body: ["principal", "name", "subscriptionId", "reason"],
    fixture: "revoke.json",
  },
  {
    id: "emit",
    method: "POST",
    path: "/emit",
    body: ["name", "data", "eventId", "principal", "subscriptionId"],
    fixture: "emit.json",
  },
  { id: "purge", method: "POST", path: "/purge", fixture: "purge.json" },
  { id: "egress", method: "GET", path: "/egress", fixture: "egress.json" },
];

/** Response types by operation id. */
export interface CloudEventsResponses {
  status: CloudEventsStatus;
  catalog: CloudEventsCatalog;
  subscriptions: CloudPage<CloudSubscriptionView>;
  subscription: CloudSubscriptionView & { attempts: CloudAttemptRecord[] };
  deliveries: CloudPage<DeliveryRow>;
  deadLetters: CloudPage<CloudDeadLetterView>;
  redeliver: { jobId: string };
  revoke: { removed: number };
  emit: { eventId: string; duplicate: boolean; accepted: boolean };
  purge: {
    terminated: number;
    hooks: number;
    undelivered: number;
    purged: number;
    deletedKeys: number;
  };
  egress: {
    ranges: Array<{ region: string; cidrs: string[] }>;
    updatedAt: string;
  };
}

/** Max page size; default 50. */
export const CLOUD_EVENTS_PAGE_LIMIT = { max: 200, default: 50 } as const;
