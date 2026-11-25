/**
 * TTL grants for webhook subscriptions (D21, PLAN.md §6.7 "TTL grant").
 *
 * @internal
 */

import { EVENTS_DEFAULTS } from "../config.js";
import type { Duration } from "../types.js";

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * Converts a {@link Duration} to milliseconds.
 *
 * @param d - A number of milliseconds or a string such as `"5m"`.
 * @returns Milliseconds.
 * @throws TypeError when the string is not a duration.
 */
export function durationMs(d: Duration): number {
  if (typeof d === "number") return d;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(d);
  if (!m) throw new TypeError(`invalid duration: ${d}`);
  return Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
}

/** Inputs of {@link grantTtl}. */
export interface TtlGrantInput {
  /** `delivery.ttlMs` as requested: absent, a number or `null` (no expiry). */
  requested: number | null | undefined;
  /** `ttlDefaultMs` of the matched known-client row, when any. */
  rowDefaultMs?: number;
  /** Per-event `ttl` bounds. */
  eventTtl?: { default?: Duration; max?: Duration };
  /** Backend capabilities that bound the grant. */
  backend: { durable: boolean; maxTtlMs: number; allowNoExpiry: boolean };
  /** `events.ttl.allowNoExpiry` (default false everywhere). */
  allowNoExpiry?: boolean;
}

/**
 * Computes the granted TTL (D21): omitted → row default, else event default,
 * else 24 h; a number is clamped to [5 min, event max ?? 7 d]; `null` grants
 * no expiry only with durable storage and `allowNoExpiry`, otherwise the
 * maximum. Every finite grant is capped by the backend (memory: 1 h).
 *
 * @param input - The request and its bounds.
 * @returns The grant in milliseconds, or `null` for no expiry.
 */
export function grantTtl(input: TtlGrantInput): number | null {
  const max = Math.max(
    EVENTS_DEFAULTS.ttlMinMs,
    input.eventTtl?.max !== undefined
      ? durationMs(input.eventTtl.max)
      : EVENTS_DEFAULTS.ttlMaxMs
  );
  const cap = (ms: number): number => Math.min(ms, input.backend.maxTtlMs);
  const clamp = (ms: number): number =>
    Math.min(Math.max(Math.round(ms), EVENTS_DEFAULTS.ttlMinMs), max);
  const { requested } = input;
  if (requested === null) {
    if (
      input.backend.durable &&
      input.backend.allowNoExpiry &&
      input.allowNoExpiry === true
    )
      return null;
    return cap(max);
  }
  if (requested === undefined) {
    const def =
      input.rowDefaultMs ??
      (input.eventTtl?.default !== undefined
        ? durationMs(input.eventTtl.default)
        : EVENTS_DEFAULTS.ttlDefaultMs);
    return cap(clamp(def));
  }
  return cap(clamp(requested));
}

/**
 * Formats `refreshBefore`: ISO 8601 UTC with milliseconds, or `null`.
 *
 * @param now - Epoch ms of the grant.
 * @param ttlMs - The grant, or `null`.
 */
export function refreshBefore(
  now: number,
  ttlMs: number | null
): string | null {
  return ttlMs === null ? null : new Date(now + ttlMs).toISOString();
}
