/**
 * Loop guard (D46): at most `deliveriesPerSubscriptionPerMinute` (60) sends
 * per subscription per window. An over-limit job is delayed to the next
 * window and the status is marked `throttle` (refreshes report `throttled`
 * and `retryAfterMs`).
 *
 * @internal
 */

import type { SubscriptionStatus } from "../internal/records.js";
import type { EngineContext } from "./jobs.js";
import { updateStatus } from "./suspension.js";

const WINDOW_MS = 60_000;

/** Result of taking a throttle slot. */
export type ThrottleResult = { ok: true } | { ok: false; retryAt: number };

/** Take one send slot for a subscription. */
export async function takeThrottleSlot(
  ctx: EngineContext,
  subscriptionId: string
): Promise<ThrottleResult> {
  const now = ctx.clock.now();
  const windowStart = now - (now % WINDOW_MS);
  let result: ThrottleResult = { ok: true };
  await updateStatus(ctx, subscriptionId, (s) => {
    if (!s.throttle || s.throttle.windowStart !== windowStart)
      s.throttle = { windowStart, count: 0 };
    if (s.throttle.count >= ctx.config.deliveriesPerSubscriptionPerMinute) {
      result = { ok: false, retryAt: windowStart + WINDOW_MS };
      return false;
    }
    s.throttle.count += 1;
  });
  return result;
}

/** Refresh view of the throttle state (`deliveryStatus.throttled`). */
export function throttleView(
  s: SubscriptionStatus,
  now: number,
  limit: number
): { throttled: boolean; retryAfterMs?: number } {
  const t = s.throttle;
  if (!t || t.count < limit || now >= t.windowStart + WINDOW_MS)
    return { throttled: false };
  return { throttled: true, retryAfterMs: t.windowStart + WINDOW_MS - now };
}
