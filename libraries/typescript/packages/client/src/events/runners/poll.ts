/**
 * Poll runner (PLAN.md §9.5.2) and the context shared by every runner.
 *
 * @internal
 */

import type { EventEnvelope } from "@mcp-use/events-core";
import type { EventsConnection } from "../connection.js";
import { EventsLaneError } from "../sdk-adapter.js";
import {
  EventsClientError,
  type ClientSubscriptionRecord,
  type EventsGap,
  type EventsTermination,
} from "../types.js";

/** Default poll interval when the server sends no `nextPollMs`. */
export const DEFAULT_POLL_MS = 10_000;
/** Floor of the poll interval. */
export const MIN_POLL_MS = 1_000;
/** Backoff bounds. */
export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;

/** What a runner needs from the manager. */
export interface RunnerContext {
  /** The current connection for the record's server (session replacement safe). */
  connection(): Promise<EventsConnection>;
  /** The record the runner drives (mutated in place). */
  record: ClientSubscriptionRecord;
  /** Deliver one event (deduped by the manager). */
  deliver(event: EventEnvelope): Promise<void>;
  /** Persist a new cursor (throttled by the manager). */
  setCursor(cursor: string | null): void;
  /** Persist the record now. */
  persist(): Promise<void>;
  /** A gap or truncation. */
  gap(g: EventsGap): void;
  /** Terminal server error; the runner returns after calling it. */
  terminate(t: EventsTermination): void;
  /** Non-terminal client error to surface. */
  error(err: EventsClientError): void;
  /** Stops the runner. */
  signal: AbortSignal;
  /** Clock and timers (tests). */
  now?: () => number;
  /** Random in [0, 1) (tests). */
  random?: () => number;
}

/** How a runner stopped. */
export type RunnerExit =
  | { kind: "stopped" }
  | { kind: "terminated" }
  | { kind: "auth" }
  | { kind: "fallback"; to: "poll" | "webhook" | "none" };

/**
 * Abortable sleep.
 *
 * @param ms - Milliseconds.
 * @param signal - Abort signal.
 * @returns Resolves after `ms` or on abort.
 */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Exponential backoff with full jitter, 1 s → 60 s.
 *
 * @param attempt - Attempt number (0-based).
 * @param random - Random source.
 * @returns Delay in ms.
 */
export function backoffMs(attempt: number, random = Math.random): number {
  const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  return Math.max(BACKOFF_MIN_MS, Math.floor(random() * cap));
}

const TERMINAL_KINDS = new Set([
  "notFound",
  "forbidden",
  "invalidParams",
  "unsupported",
]);

/** Classification of a runner request failure. */
export type FailureAction =
  | { action: "terminal"; termination: EventsTermination }
  | { action: "auth" }
  | { action: "wait"; ms: number }
  | { action: "backoff" };

/**
 * Classify a request failure for the runners.
 *
 * @param err - The thrown error.
 * @returns What the runner should do.
 */
export function classifyFailure(err: unknown): FailureAction {
  if (err instanceof EventsClientError && err.code === "auth_required") {
    return { action: "auth" };
  }
  if (err instanceof EventsLaneError) {
    const data =
      err.data !== null && typeof err.data === "object"
        ? (err.data as Record<string, unknown>)
        : undefined;
    if (err.kind && TERMINAL_KINDS.has(err.kind)) {
      return {
        action: "terminal",
        termination: {
          kind: err.kind,
          code: err.code,
          ...(data ? { data } : {}),
        },
      };
    }
    if (err.kind === "resourceExhausted") {
      const ms = Number(data?.retryAfterMs);
      return {
        action: "wait",
        ms: Number.isFinite(ms) && ms > 0 ? ms : BACKOFF_MIN_MS,
      };
    }
  }
  return { action: "backoff" };
}

/**
 * Run the poll loop until stopped or terminated.
 *
 * @param ctx - Runner context.
 * @param opts - First-request replay floor.
 * @returns How the runner stopped.
 */
export async function runPoll(
  ctx: RunnerContext,
  opts: { maxAgeMs?: number } = {}
): Promise<RunnerExit> {
  let attempt = 0;
  let first = true;
  const random = ctx.random ?? Math.random;
  while (!ctx.signal.aborted) {
    let wait: number;
    try {
      const conn = await ctx.connection();
      const maxAgeMs = first
        ? (opts.maxAgeMs ?? ctx.record.maxAgeMs)
        : undefined;
      const result = await conn.pollEvents(
        {
          name: ctx.record.name,
          arguments: ctx.record.args,
          cursor: ctx.record.cursor,
          ...(maxAgeMs !== undefined && ctx.record.cursor === null
            ? { maxAgeMs }
            : {}),
        },
        { signal: ctx.signal }
      );
      first = false;
      attempt = 0;
      if (result.truncated) {
        ctx.gap({ cursor: result.cursor, reason: "truncated" });
      }
      for (const e of result.events) {
        if (ctx.signal.aborted) break;
        const delivered = ctx.deliver(e);
        if (typeof e.cursor === "string") ctx.setCursor(e.cursor);
        await delivered;
      }
      if (ctx.signal.aborted) break;
      ctx.setCursor(result.cursor);
      wait = result.hasMore
        ? 0
        : Math.max(
            Math.floor(result.nextPollMs ?? DEFAULT_POLL_MS),
            MIN_POLL_MS
          );
    } catch (err) {
      if (ctx.signal.aborted) break;
      const f = classifyFailure(err);
      if (f.action === "terminal") {
        ctx.terminate(f.termination);
        return { kind: "terminated" };
      }
      if (f.action === "auth") return { kind: "auth" };
      wait = f.action === "wait" ? f.ms : backoffMs(attempt++, random);
    }
    if (wait > 0) await sleep(wait, ctx.signal);
  }
  return { kind: "stopped" };
}
