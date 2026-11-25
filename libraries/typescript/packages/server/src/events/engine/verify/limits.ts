/**
 * Verification limits (D29): 4 in flight per host
 * (`ev:{ns}:inflight-verify:{host}`), 10/min per `(principal, host)` and
 * 600/min per host (`ev:{ns}:rl:verify:…` counters via `incr`).
 *
 * @internal
 */

import type { EngineContext } from "../jobs.js";

/** Verification limit knobs. */
export interface VerifyLimits {
  inFlightPerHost: number;
  perPrincipalHostPerMinute: number;
  perHostPerMinute: number;
}

/** Result of acquiring a verification slot. */
export type VerifySlot =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; retryAfterMs: number };

/**
 * Take one verification slot for `(principal, host)`; the caller must call
 * `release` when the POST settles.
 */
export async function acquireVerifySlot(
  ctx: EngineContext,
  principal: string,
  host: string,
  limits: VerifyLimits,
  timeoutMs: number
): Promise<VerifySlot> {
  const now = ctx.clock.now();
  const minute = Math.floor(now / 60_000);
  const toNextMinute = (minute + 1) * 60_000 - now;
  const perHost = await ctx.storage.incr(ctx.keys.rlVerifyHost(host, minute), {
    ttlMs: 120_000,
  });
  if (perHost > limits.perHostPerMinute)
    return { ok: false, retryAfterMs: toNextMinute };
  const perPrincipal = await ctx.storage.incr(
    ctx.keys.rlVerifyPrincipal(principal, host, minute),
    { ttlMs: 120_000 }
  );
  if (perPrincipal > limits.perPrincipalHostPerMinute)
    return { ok: false, retryAfterMs: toNextMinute };
  const key = ctx.keys.inflightVerify(host);
  // The TTL bounds a crashed holder: twice the verification timeout.
  const ttlMs = 2 * timeoutMs;
  const inflight = await ctx.storage.incr(key, { ttlMs });
  if (inflight > limits.inFlightPerHost) {
    await ctx.storage.incr(key, { ttlMs, by: -1 });
    return { ok: false, retryAfterMs: 1000 };
  }
  let released = false;
  return {
    ok: true,
    release: async () => {
      if (released) return;
      released = true;
      await ctx.storage.incr(key, { ttlMs, by: -1 });
    },
  };
}
