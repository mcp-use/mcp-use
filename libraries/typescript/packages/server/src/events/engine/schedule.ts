/**
 * The D20 retry schedule: relative delays 0, 30 s, 2 m, 5 m, 7 m with ±20 %
 * jitter, cumulative ≤ the window, stored relative on the job at creation.
 * Paused time (`pausedMs`) extends the window; `Retry-After` is clamped.
 *
 * @internal
 */

import type { Clock } from "../internal/clock.js";
import type { Scheduled } from "../internal/records.js";
import type { JobRuntimeConfig } from "./jobs.js";

/**
 * Jittered relative delays whose sum never exceeds `windowMs`. The first
 * delay (0) is never jittered.
 */
export function jitteredDelays(
  base: readonly number[],
  jitter: number,
  windowMs: number,
  clock: Clock
): number[] {
  const out: number[] = [];
  let total = 0;
  for (const d of base) {
    const j =
      d === 0 ? 0 : Math.round(d * (1 + (clock.random() * 2 - 1) * jitter));
    const next = Math.max(0, Math.min(j, windowMs - total));
    out.push(next);
    total += next;
  }
  return out;
}

/** Fresh schedule fields for a job created at `now`. */
export function newSchedule(
  config: JobRuntimeConfig,
  clock: Clock,
  now: number
): Scheduled {
  return {
    attempt: 0,
    delays: jitteredDelays(
      config.retryDelaysMs,
      config.retryJitter,
      config.retryWindowMs,
      clock
    ),
    firstAttemptAt: null,
    lastAttemptAt: null,
    pausedMs: 0,
    nextAt: now,
    maxAgeAt: now + config.retryMaxAgeMs,
  };
}

/** Outcome of planning the next attempt after a retryable failure. */
export type NextAttempt = { at: number } | { exhausted: true };

/**
 * Plan the attempt after attempt number `s.attempt` (already incremented).
 * `retryAfterMs` (429/503) is clamped to [scheduled, 2 × scheduled] and to
 * the window end.
 */
export function nextAttempt(
  s: Scheduled,
  config: JobRuntimeConfig,
  now: number,
  retryAfterMs?: number
): NextAttempt {
  if (s.attempt >= s.delays.length) return { exhausted: true };
  const scheduled = s.delays[s.attempt]!;
  let delay = scheduled;
  if (retryAfterMs !== undefined && retryAfterMs > scheduled)
    delay = Math.min(retryAfterMs, 2 * scheduled);
  const first = s.firstAttemptAt ?? now;
  const windowEnd = first + config.retryWindowMs + s.pausedMs;
  const at = Math.min(now + delay, windowEnd);
  if (now >= windowEnd) return { exhausted: true };
  return { at };
}

/** Add paused time (suspension, open breaker, no processor) to a job. */
export function pause(s: Scheduled, ms: number): void {
  if (ms > 0 && s.firstAttemptAt !== null) s.pausedMs += ms;
}

/** Parse a `Retry-After` header (seconds or HTTP date) into ms. */
export function parseRetryAfter(
  value: string | undefined,
  now: number
): number | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}
