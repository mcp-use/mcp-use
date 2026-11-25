/**
 * Subscription status (`ev:{ns}:status:{id}`): attempt buckets, suspension
 * (more than 95 % failures over a rolling 60 min with at least 100 attempts),
 * `lastError`, `gapPending` and the throttle window.
 *
 * @internal
 */

import type { DeliveryErrorCategory } from "@mcp-use/events-core";
import type { SubscriptionStatus } from "../internal/records.js";
import type { EngineContext } from "./jobs.js";

/** A fresh, active status. */
export function emptyStatus(): SubscriptionStatus {
  return {
    v: 1,
    active: true,
    lastDeliveryAt: null,
    lastError: null,
    gapPending: false,
    buckets: [],
    abandoned: 0,
  };
}

/** Read a status (missing → fresh). */
export async function readStatus(
  ctx: EngineContext,
  subscriptionId: string
): Promise<{ status: SubscriptionStatus; version: string | null }> {
  const got = await ctx.storage.read(ctx.keys.status(subscriptionId));
  if (!got) return { status: emptyStatus(), version: null };
  return {
    status: {
      ...emptyStatus(),
      ...(JSON.parse(got.value) as SubscriptionStatus),
    },
    version: got.version,
  };
}

/**
 * Read-modify-write a status with CAS retries. `mutate` returns false to skip
 * the write.
 */
export async function updateStatus(
  ctx: EngineContext,
  subscriptionId: string,
  mutate: (s: SubscriptionStatus) => boolean | void
): Promise<SubscriptionStatus> {
  for (let i = 0; i < 8; i++) {
    const { status, version } = await readStatus(ctx, subscriptionId);
    if (mutate(status) === false) return status;
    const ok = await ctx.storage.write(
      ctx.keys.status(subscriptionId),
      JSON.stringify(status),
      { ifVersion: version }
    );
    if (ok !== false) return status;
  }
  throw new Error("mcp-use events: status update contention");
}

/** Add one attempt to the 60 one-minute buckets. */
export function addAttempt(
  s: SubscriptionStatus,
  now: number,
  failed: boolean,
  windowMs: number
): void {
  const minute = Math.floor(now / 60_000);
  const oldest = minute - Math.ceil(windowMs / 60_000) + 1;
  s.buckets = s.buckets.filter(([m]) => m >= oldest);
  const last = s.buckets[s.buckets.length - 1];
  if (last && last[0] === minute) {
    last[1] += 1;
    if (failed) last[2] += 1;
  } else s.buckets.push([minute, 1, failed ? 1 : 0]);
}

/** Whether the buckets cross the suspension threshold. */
export function shouldSuspend(
  s: SubscriptionStatus,
  rate: number,
  minAttempts: number
): boolean {
  let attempts = 0;
  let failures = 0;
  for (const [, a, f] of s.buckets) {
    attempts += a;
    failures += f;
  }
  return attempts >= minAttempts && failures / attempts > rate;
}

/**
 * Record an attempt outcome; suspends the subscription when the threshold is
 * crossed.
 *
 * @returns Whether this call suspended the subscription.
 */
export async function recordAttemptOutcome(
  ctx: EngineContext,
  subscriptionId: string,
  outcome: { ok: true } | { ok: false; error: DeliveryErrorCategory },
  noExpiry: boolean
): Promise<boolean> {
  let suspended = false;
  const now = ctx.clock.now();
  await updateStatus(ctx, subscriptionId, (s) => {
    addAttempt(s, now, !outcome.ok, ctx.config.suspensionWindowMs);
    if (outcome.ok) {
      s.lastDeliveryAt = now;
      s.lastError = null;
      delete s.failedSince;
    } else {
      s.lastError = outcome.error;
      s.failedSince ??= now;
    }
    if (
      s.active &&
      shouldSuspend(
        s,
        ctx.config.suspensionFailureRate,
        ctx.config.suspensionMinAttempts
      )
    ) {
      s.active = false;
      s.suspendedAt = now;
      s.suspendedExpiresAt = noExpiry
        ? now + ctx.config.dropNoExpiryAfterMs
        : null;
      suspended = true;
    }
  });
  if (suspended)
    ctx.log({
      type: "suspend",
      subscription: subscriptionId,
      reason: "failure_rate",
    });
  return suspended;
}

/**
 * Reactivate a suspended subscription (refresh) and re-add every parked job
 * found in `inflight:{id}` to `idx due` at now.
 *
 * @returns Whether the subscription was suspended.
 */
export async function resumeSubscription(
  ctx: EngineContext,
  subscriptionId: string
): Promise<boolean> {
  let was = false;
  await updateStatus(ctx, subscriptionId, (s) => {
    if (s.active) return false;
    was = true;
    s.active = true;
    s.buckets = [];
    delete s.suspendedAt;
    delete s.suspendedExpiresAt;
  });
  if (!was) return false;
  const now = ctx.clock.now();
  let after: string | undefined;
  do {
    const page = await ctx.storage.indexRange(
      ctx.keys.inflight(subscriptionId),
      { limit: 200, ...(after ? { after } : {}) }
    );
    for (const { member } of page.items)
      if (!member.startsWith("r."))
        await ctx.storage.indexAdd(ctx.keys.due(), member, now, {
          onlyIfAbsent: true,
        });
    after = page.next;
  } while (after);
  ctx.log({ type: "resume", subscription: subscriptionId, reason: "refresh" });
  return true;
}
