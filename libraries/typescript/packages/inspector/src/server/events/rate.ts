/**
 * Per-inbox hook rate limiting for the Inspector Events inbox (D71).
 *
 * Counters live in the inbox store (`insp:rl:{id}:{minute}`, an `incr`
 * counter with a 120 s TTL), so every replica of a hosted Inspector shares
 * one budget per inbox.
 */
import type { InboxStorage } from "./inbox-store.js";

/** Hooks accepted per inbox per wall-clock minute. */
export const INBOX_HOOKS_PER_MINUTE = 600;

/** Lifetime of one minute's counter, in milliseconds. */
export const INBOX_RATE_COUNTER_TTL_MS = 120_000;

/** Outcome of {@link takeInboxRate}. */
export interface InboxRateResult {
  /** Whether the hook is within the per-minute budget. */
  allowed: boolean;
  /** The counter value after this hook. */
  count: number;
  /** Seconds until the current minute ends (a `Retry-After` value). */
  retryAfterSec: number;
}

/**
 * Counts one hook against the inbox's budget for the current minute.
 *
 * @param storage - The inbox store.
 * @param inboxId - The inbox the hook is for.
 * @param now - Current time in epoch milliseconds.
 * @param limit - Hooks allowed per minute; default {@link INBOX_HOOKS_PER_MINUTE}.
 * @returns Whether the hook is allowed and the counter value.
 */
export async function takeInboxRate(
  storage: InboxStorage,
  inboxId: string,
  now: number = Date.now(),
  limit: number = INBOX_HOOKS_PER_MINUTE
): Promise<InboxRateResult> {
  const minute = Math.floor(now / 60_000);
  const count = await storage.incr(`insp:rl:${inboxId}:${minute}`, {
    ttlMs: INBOX_RATE_COUNTER_TTL_MS,
  });
  const retryAfterSec = Math.max(
    1,
    Math.ceil(((minute + 1) * 60_000 - now) / 1000)
  );
  return { allowed: count <= limit, count, retryAfterSec };
}
