/**
 * Internal route contract (PLAN.md §12.3.2, D41): paths under
 * `{basePath}/_mcp-use/events/`, auth classes, request and response types,
 * and the `x-mcp-use-confirm` header. Locked by
 * `contracts/events/routes.json`. Implemented by WP-26.
 *
 * @internal
 */

import type { DeadLetterView, EventsStatus } from "../admin/types.js";
import type { AttemptRecord } from "../internal/records.js";
import type {
  EmitResult,
  EventsHealth,
  StreamView,
  SubscriptionView,
  TickReport,
} from "../types.js";

/** Path segment under the MCP base path. */
export const EVENTS_ROUTE_PREFIX = "/_mcp-use/events";

/** Header required on `POST emit` outside dev: the namespace or its hash. */
export const CONFIRM_HEADER = "x-mcp-use-confirm";

/**
 * Who may call a route.
 * - `tick`: tick secret, `CRON_SECRET`, user or platform admin secret, dev token.
 * - `admin`: user or platform admin secret, dev token.
 * - `admin-no-dev`: user or platform admin secret only.
 */
export type EventsRouteAuth = "tick" | "admin" | "admin-no-dev";

/** One internal route. */
export interface EventsRouteSpec {
  id: string;
  methods: readonly ("GET" | "POST")[];
  /** Relative to `{basePath}/_mcp-use/events/`; `:id` is a path parameter. */
  path: string;
  auth: EventsRouteAuth;
  /** Query parameters accepted. */
  query?: readonly string[];
  /** Extra required headers outside the dev runtime. */
  requiredHeaders?: readonly string[];
}

/** The route table. */
export const EVENTS_ROUTES: readonly EventsRouteSpec[] = [
  { id: "tick", methods: ["GET", "POST"], path: "tick", auth: "tick" },
  { id: "health", methods: ["GET"], path: "health", auth: "admin" },
  {
    id: "emit",
    methods: ["POST"],
    path: "emit",
    auth: "admin",
    requiredHeaders: [CONFIRM_HEADER],
  },
  {
    id: "admin.subscriptions",
    methods: ["GET"],
    path: "admin/subscriptions",
    auth: "admin",
    query: ["name", "principal", "status", "mode", "after", "limit"],
  },
  {
    id: "admin.subscription",
    methods: ["GET"],
    path: "admin/subscriptions/:id",
    auth: "admin",
  },
  {
    id: "admin.leases",
    methods: ["GET"],
    path: "admin/leases",
    auth: "admin",
    query: ["name", "principal", "after", "limit"],
  },
  {
    id: "admin.dead-letters",
    methods: ["GET"],
    path: "admin/dead-letters",
    auth: "admin",
    query: ["subscriptionId", "after", "limit"],
  },
  {
    id: "admin.redeliver",
    methods: ["POST"],
    path: "admin/dead-letters/:id/redeliver",
    auth: "admin",
  },
  {
    id: "admin.revoke",
    methods: ["POST"],
    path: "admin/revoke",
    auth: "admin",
  },
  {
    id: "admin.streams",
    methods: ["GET"],
    path: "admin/streams",
    auth: "admin",
  },
  {
    id: "admin.decommission",
    methods: ["POST"],
    path: "admin/decommission",
    auth: "admin-no-dev",
  },
];

/** `POST emit` body. Ids get the `test_` prefix and entries `test: true` (D38). */
export interface EmitRouteRequest {
  name: string;
  data: unknown;
  eventId?: string;
  principal?: string;
  subscriptionId?: string;
}

/** `POST admin/revoke` body: at least one of principal or subscriptionId. */
export interface RevokeRouteRequest {
  principal?: string;
  subscriptionId?: string;
  name?: string;
  reason?: string;
}

/** `POST admin/decommission` body. */
export interface DecommissionRouteRequest {
  reason?: string;
  /** ≤ 120000; default 60000. */
  deadlineMs?: number;
}

/** `POST admin/decommission` response. Idempotent (D68). */
export interface DecommissionRouteResponse {
  terminated: number;
  hooks: number;
  undelivered: number;
  purged: number;
}

/** Response bodies by route id. Admin routes return byte-identical JSON to the admin library. */
export interface EventsRouteResponses {
  tick: TickReport;
  health: EventsHealth;
  emit: EmitResult;
  "admin.subscriptions": { items: SubscriptionView[]; next?: string };
  "admin.subscription": SubscriptionView & { attempts: AttemptRecord[] };
  "admin.leases": { items: SubscriptionView[]; next?: string };
  "admin.dead-letters": { items: DeadLetterView[]; next?: string };
  "admin.redeliver": { jobId: string };
  "admin.revoke": { removed: number };
  "admin.streams": StreamView[];
  "admin.decommission": DecommissionRouteResponse;
}

/** `503` body of `tick` when the store is unreachable. */
export interface DegradedResponse {
  state: "degraded";
}

/** Error body of internal routes: 400, 401, 404. */
export interface RouteErrorResponse {
  error: { code: string; message: string; data?: Record<string, unknown> };
}

export type { EventsStatus };
