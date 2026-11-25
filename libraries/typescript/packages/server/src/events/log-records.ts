/**
 * `EventsLogRecord` (PLAN.md §14.1), schema `mcp-use.events.log/1`.
 *
 * @packageDocumentation
 */

import type {
  DeliveryErrorCategory,
  EventsErrorKind,
  EventsSignals,
} from "@mcp-use/events-core";
import type { EventsSdkInfo } from "./types.js";

/** Schema id written on every JSON log line. */
export const EVENTS_LOG_SCHEMA = "mcp-use.events.log/1";

/** One structured engine log record. Consumers parse string fields as open strings. */
export type EventsLogRecord =
  | {
      type: "subscribe" | "refresh" | "unsubscribe" | "revoke";
      name: string;
      subscription: string;
      profile: string;
      via: string;
      era: "legacy" | "modern";
      callbackHost?: string;
      cursor?: "null" | "set";
      truncated?: boolean;
      outcome: "ok" | EventsErrorKind;
      ms: number;
    }
  | {
      type: "verify";
      callbackHost: string;
      via?: "challenge" | "allowlist" | "trusted-origin" | "well-known";
      outcome: "ok" | "reflected" | DeliveryErrorCategory;
      cached: boolean;
      ms: number;
    }
  | {
      type: "emit";
      name: string;
      eventId: string;
      seq: number;
      duplicate: boolean;
      accepted: boolean;
      test?: true;
      ms: number;
    }
  | {
      type: "fanout";
      name: string;
      fromSeq: number;
      toSeq: number;
      matched: number;
      jobs: number;
      pages: number;
      ms: number;
    }
  | {
      type: "deliver";
      name: string;
      subscription: string;
      kind: "event" | "gap" | "terminated" | "verification";
      attempt: number;
      redelivery?: true;
      outcome:
        | "2xx"
        | "4xx"
        | "5xx"
        | "410"
        | "413"
        | "timeout"
        | "connection_refused"
        | "tls_error";
      ms: number;
      nextRetryMs?: number;
    }
  | {
      type: "poll";
      name: string;
      profile: string;
      events: number;
      truncated: boolean;
      hasMore: boolean;
      outcome: "ok" | EventsErrorKind;
      ms: number;
    }
  | {
      type: "stream_opened";
      name: string;
      subscription: string;
      heartbeatMs: number;
      truncated: boolean;
      instance: string;
    }
  | {
      type: "stream_closed";
      name: string;
      subscription: string;
      reason:
        | "rotation"
        | "token_expiry"
        | "client_abort"
        | "backlog"
        | "terminated"
        | "shutdown"
        | "hot_reload"
        | "error";
      events: number;
      durationMs: number;
    }
  | {
      type:
        | "abandon"
        | "suspend"
        | "resume"
        | "sweep"
        | "oversize"
        | "stale"
        | "dead_letter"
        | "redeliver"
        | "loop_suspected"
        | "mcp_name_missing";
      subscription?: string;
      name?: string;
      reason: string;
    }
  | { type: "fanout_overflow"; name: string; lost: number }
  | {
      type: "pending_overflow";
      name: string;
      subscription: string;
      pending: number;
    }
  | {
      type: "profile_unknown";
      subscription: string;
      preset: string;
      revision?: number;
      axis?: string;
    }
  | { type: "client_signals"; clientName: string; signals: EventsSignals }
  | {
      type: "tick";
      attempted: number;
      expired: number;
      remaining: number;
      nextWakeAt: string | null;
      ms: number;
    }
  | {
      type: "decommission";
      terminated: number;
      hooks: number;
      undelivered: number;
      purged: number;
      reason?: string;
    }
  | {
      type: "backend";
      state: "ready" | "degraded" | "unconfigured";
      binding: "user" | "dev" | "platform" | "memory" | "inert";
      kind: string;
      layout: 1 | null;
      sender: "node-pinned" | "node-pinned+proxy" | "fetch";
      sdk: EventsSdkInfo;
      build?: { sha: string };
      reason?: string;
    };
