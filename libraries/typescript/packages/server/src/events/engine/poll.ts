/**
 * `events/poll` (D51, PLAN.md §6.10): stateless, served from the log.
 *
 * @internal
 */

import {
  EventsError,
  DIRECT_SUBSCRIPTION_URL,
  deriveDirectId,
  normalizeArguments,
} from "@mcp-use/events-core";
import type { EventEnvelope, PollEventsResult } from "@mcp-use/events-core";
import { EVENTS_DEFAULTS } from "../config.js";
import type { EventsBackend } from "../internal/backend.js";
import type { LogValue } from "../internal/records.js";
import type { EventsRegistry, RegisteredEvent } from "../internal/registry.js";
import type { SubscriptionInfo } from "../types.js";
import { effectiveModes, type ModeEnvironment } from "./list.js";
import type { LeaseToucher } from "./leases.js";
import { ANONYMOUS_PRINCIPAL, type RateLimiter } from "./quotas.js";
import { durationMs } from "./ttl.js";

/** A resolved cursor position (D49). */
export interface ResolvedCursor {
  epoch: string | null;
  /** Position: the last seq consumed. */
  seq: number;
  /** The cursor was reset (stale, other epoch, beyond head, unverifiable). */
  reset: boolean;
  /** Entries before this append time are skipped (`maxAgeMs` floor), or null. */
  floor: number | null;
}

/** Cursor encoding and resolution (WP-13 implements it). */
export interface CursorCodec {
  encode(name: string, epoch: string | null, seq: number): Promise<string>;
  /** Resolves a non-null cursor against the log; never throws for bad cursors. */
  resolve(
    name: string,
    cursor: string,
    o: { maxAgeMs?: number; now: number }
  ): Promise<ResolvedCursor>;
}

/** Whether a log entry targets this caller (§6.10 "Targeting"). */
export function targets(
  to: { principals?: string[]; subscriptionId?: string; all?: true } | undefined,
  principal: string,
  directId: string
): boolean {
  if (to === undefined) return true;
  if ((to as { all?: true }).all === true) return true;
  if (to.subscriptionId !== undefined) return to.subscriptionId === directId;
  if (to.principals !== undefined) return to.principals.includes(principal);
  return true;
}

/** The event envelope of a log entry, without `cursor`. */
export function occurrence(
  name: string,
  v: Extract<LogValue, { k: "e" }>
): EventEnvelope {
  const env: EventEnvelope = {
    eventId: v.id,
    name,
    timestamp: v.ts,
    data: v.data,
  };
  if (v.meta !== undefined) env._meta = v.meta;
  return env;
}

/**
 * `nextPollMs`: event `pollInterval` ?? the configured interval, integer
 * ≥ 1000, capped at `lease.ttl / 3` for events with hooks.
 */
export function nextPollMs(ev: RegisteredEvent, configuredMs: number): number {
  const raw =
    ev.definition.pollInterval !== undefined
      ? durationMs(ev.definition.pollInterval)
      : configuredMs;
  let ms = Math.max(EVENTS_DEFAULTS.pollIntervalMinMs, Math.round(raw));
  if (ev.hooks.onSubscribe || ev.hooks.onUnsubscribe) {
    const ttl = Math.max(EVENTS_DEFAULTS.leaseTtlMinMs, 3 * ms);
    ms = Math.min(ms, Math.floor(ttl / 3));
  }
  return ms;
}

/** Request-scoped collaborators of {@link handlePoll}. */
export interface PollDeps {
  registry: EventsRegistry;
  backend: Pick<EventsBackend, "readLog" | "isRevoked">;
  codec: CursorCodec;
  env: ModeEnvironment;
  era: "legacy" | "modern";
  listedModes: string;
  now(): number;
  /** `events.poll.interval` (10 s default, `MCP_USE_EVENTS_POLL_INTERVAL_MS`). */
  pollIntervalMs: number;
  isDormant(name: string): boolean;
  isVisible(ev: RegisteredEvent): Promise<boolean>;
  validateArgs(ev: RegisteredEvent, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  principal(): string | null;
  /** The client address (peer or gateway `X-Forwarded-For`); keys anonymous rates. */
  clientAddress?: string;
  authorize(ev: RegisteredEvent, args: Record<string, unknown>): Promise<boolean>;
  isClosed(): Promise<boolean>;
  rate: RateLimiter;
  leases?: LeaseToucher;
  onSubscribe(ev: RegisteredEvent, info: SubscriptionInfo<Record<string, unknown>>): Promise<void>;
}

/** The −32601 error the legacy era answers for poll and stream. */
export function methodNotFound(): Error & { code: number } {
  return Object.assign(new Error("Method not found"), { code: -32601 });
}

/** The validated common part of a poll or stream request. */
export interface DirectRequest {
  ev: RegisteredEvent;
  name: string;
  args: Record<string, unknown>;
  principal: string;
  directId: string;
  cursor: string | null;
  maxAgeMs?: number;
  maxEvents?: number;
}

/** Collaborators shared by poll and stream validation. */
export type DirectValidationDeps = Pick<
  PollDeps,
  | "registry"
  | "backend"
  | "env"
  | "era"
  | "listedModes"
  | "isDormant"
  | "isVisible"
  | "validateArgs"
  | "principal"
  | "authorize"
  | "isClosed"
>;

/**
 * Steps 0–4 of the D51 order, shared by `events/poll` and `events/stream`.
 *
 * @throws An `Error` with `code: -32601` on the legacy era, otherwise EventsError.
 */
export async function validateDirectRequest(
  params: Record<string, unknown>,
  deps: DirectValidationDeps,
  mode: "poll" | "push"
): Promise<DirectRequest> {
  if (deps.era === "legacy") throw methodNotFound();
  const name = typeof params.name === "string" ? params.name : "";
  const ev = deps.registry.get(name);
  if (!ev || deps.isDormant(name) || !(await deps.isVisible(ev)))
    throw new EventsError("notFound", "", { kind: "event" });
  if (
    deps.listedModes === "webhookOnly" ||
    !effectiveModes(ev, deps.env).includes(mode)
  )
    throw new EventsError("unsupported", "", {
      feature: "deliveryMode",
      value: mode,
    });
  const args = await deps.validateArgs(ev, normalizeArguments(params.arguments));
  const maxEvents = params.maxEvents;
  if (
    mode === "poll" &&
    maxEvents !== undefined &&
    (typeof maxEvents !== "number" || !Number.isInteger(maxEvents))
  )
    throw new EventsError("invalidParams", "", { field: "maxEvents" });
  const maxAgeMs = params.maxAgeMs;
  if (
    maxAgeMs !== undefined &&
    (typeof maxAgeMs !== "number" || !Number.isInteger(maxAgeMs) || maxAgeMs < 0)
  )
    throw new EventsError("invalidParams", "", { field: "maxAgeMs" });
  const cursor = params.cursor;
  if (cursor !== undefined && cursor !== null && typeof cursor !== "string")
    throw new EventsError("invalidParams", "", { field: "cursor" });

  const principal = deps.principal();
  if (principal === null)
    throw new EventsError("forbidden", "", { reason: "principal_required" });
  const directId = await deriveDirectId({ principal, name, arguments: args });
  // Revocations of poll and push reach callers through control entries in the log (D56); a direct-key tombstone is also honoured here.
  if (await deps.backend.isRevoked({ principal, url: DIRECT_SUBSCRIPTION_URL, name, args }))
    throw new EventsError("forbidden", "", { reason: "revoked" });
  if (!(await deps.authorize(ev, args)))
    throw new EventsError("forbidden", "", { reason: "not_authorized" });
  if (await deps.isClosed())
    throw new EventsError("forbidden", "", { reason: "closed" });
  return {
    ev,
    name,
    args,
    principal,
    directId,
    cursor: (cursor as string | null | undefined) ?? null,
    ...(maxAgeMs !== undefined ? { maxAgeMs: maxAgeMs as number } : {}),
    ...(typeof maxEvents === "number" ? { maxEvents } : {}),
  };
}

/**
 * Serves one `events/poll` in the D51 validation order.
 *
 * @throws An `Error` with `code: -32601` on the legacy era, otherwise EventsError.
 */
export async function handlePoll(
  params: Record<string, unknown>,
  deps: PollDeps
): Promise<Omit<PollEventsResult, "cursor"> & { cursor: string; nextPollMs: number }> {
  const { ev, name, args, principal, directId, maxAgeMs, maxEvents: maxEventsRaw } =
    await validateDirectRequest(params, deps, "poll");
  const cursorIn = params.cursor as string | null | undefined;
  const now = deps.now();
  const rateKey =
    principal === ANONYMOUS_PRINCIPAL
      ? `addr:${deps.clientAddress ?? "unknown"}|${name}`
      : `p:${principal}|${name}`;
  const retryAfterMs = deps.rate.hit(rateKey, now);
  if (retryAfterMs !== null)
    throw new EventsError("resourceExhausted", "", {
      limit: "pollRate",
      retryAfterMs,
    });

  const interval = nextPollMs(ev, deps.pollIntervalMs);
  if (deps.leases)
    await deps.leases.touch({
      ev,
      id: directId,
      principal,
      args,
      mode: "poll",
      nextPollMs: interval,
      now,
      onSubscribe: (info) => deps.onSubscribe(ev, info),
    });

  const maxEvents = Math.min(
    Math.max(maxEventsRaw ?? EVENTS_DEFAULTS.pollMaxEvents, 1),
    EVENTS_DEFAULTS.pollMaxEventsCap
  );
  const base = { nextPollMs: interval };
  if (cursorIn === undefined || cursorIn === null) {
    const head = await deps.backend.readLog(name, null, { limit: 0 });
    return {
      events: [],
      cursor: await deps.codec.encode(name, head.epoch, head.head),
      truncated: false,
      hasMore: false,
      ...base,
    };
  }
  const start = await deps.codec.resolve(name, cursorIn, {
    ...(maxAgeMs !== undefined ? { maxAgeMs } : {}),
    now,
  });
  if (start.reset) {
    const head = await deps.backend.readLog(name, null, { limit: 0 });
    return {
      events: [],
      cursor: await deps.codec.encode(name, start.epoch, start.seq),
      truncated: true,
      hasMore: start.seq < head.head,
      ...base,
    };
  }

  const events: EventEnvelope[] = [];
  let pos = start.seq;
  let scanned = 0;
  let truncated = false;
  let head = pos;
  const budget = EVENTS_DEFAULTS.pollScanBudget;
  const match = { principal, subscriptionId: directId, dialect: "sep-3415", mode: "poll" as const };
  scan: while (events.length < maxEvents && scanned < budget) {
    const page = await deps.backend.readLog(name, pos, {
      limit: Math.min(200, budget - scanned),
    });
    head = page.head;
    if (page.epoch !== start.epoch || page.first > pos + 1) {
      return {
        events,
        cursor: await deps.codec.encode(name, page.epoch, page.first - 1),
        truncated: true,
        hasMore: true,
        ...base,
      };
    }
    if (page.entries.length === 0) break;
    for (const entry of page.entries) {
      const v = entry.value;
      if (v.k === "t") {
        if (targets(v.to, principal, directId))
          throw new EventsError(v.error.kind, v.error.message, v.error.data);
        pos = entry.seq;
        scanned++;
        continue;
      }
      pos = entry.seq;
      scanned++;
      if (start.floor !== null && v.at < start.floor) {
        truncated = true;
        continue;
      }
      if (v.to?.subscriptionId !== undefined) continue;
      if (!targets(v.to, principal, directId)) continue;
      if (await ev.match(args, v.data, match)) events.push(occurrence(name, v));
      if (events.length >= maxEvents) break scan;
    }
  }
  return {
    events,
    cursor: await deps.codec.encode(name, start.epoch, pos),
    truncated: truncated || start.reset,
    hasMore: pos < head,
    ...base,
  };
}
