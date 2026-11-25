/**
 * Per-host circuit breaker `ev:{ns}:cb:{host}` (10 min TTL): 20 consecutive
 * connection-class failures open it for 30 s, then 2 m, then 5 m on repeated
 * trips. Attempts are not consumed while it is open (§8.10.2 step 8).
 *
 * @internal
 */

import type { DeliveryErrorCategory } from "@mcp-use/events-core";
import type { EngineContext } from "./jobs.js";

/** Stored breaker state. */
export interface BreakerState {
  v: 1;
  failures: number;
  trips: number;
  openUntil: number | null;
}

const TTL_MS = 10 * 60_000;

/** Whether a failure category counts toward the breaker. */
export function isConnectionClass(
  c: DeliveryErrorCategory | "dns_failure"
): boolean {
  return (
    c === "connection_refused" ||
    c === "timeout" ||
    c === "tls_error" ||
    c === "dns_failure"
  );
}

async function read(
  ctx: EngineContext,
  host: string
): Promise<{ state: BreakerState; version: string | null }> {
  const got = await ctx.storage.read(ctx.keys.cb(host));
  if (!got)
    return {
      state: { v: 1, failures: 0, trips: 0, openUntil: null },
      version: null,
    };
  return { state: JSON.parse(got.value) as BreakerState, version: got.version };
}

/** The time the breaker of `host` closes, or null when closed. */
export async function breakerOpenUntil(
  ctx: EngineContext,
  host: string
): Promise<number | null> {
  const { state } = await read(ctx, host);
  return state.openUntil !== null && state.openUntil > ctx.clock.now()
    ? state.openUntil
    : null;
}

/**
 * Record one attempt outcome for `host`. A success resets the failure count;
 * the 20th consecutive connection-class failure opens the breaker.
 *
 * @returns The open-until time when this call opened it.
 */
export async function recordBreaker(
  ctx: EngineContext,
  host: string,
  success: boolean,
  connectionClass: boolean
): Promise<number | null> {
  for (let i = 0; i < 5; i++) {
    const { state, version } = await read(ctx, host);
    const now = ctx.clock.now();
    let opened: number | null = null;
    if (success) {
      if (state.failures === 0 && state.openUntil === null) return null;
      state.failures = 0;
      state.openUntil = null;
    } else if (connectionClass) {
      state.failures += 1;
      if (state.failures >= ctx.config.breakerFailures) {
        const steps = ctx.config.breakerOpenForMs;
        const ms = steps[Math.min(state.trips, steps.length - 1)]!;
        state.trips += 1;
        state.failures = 0;
        state.openUntil = opened = now + ms;
      }
    } else return null;
    const ok = await ctx.storage.write(
      ctx.keys.cb(host),
      JSON.stringify(state),
      {
        ifVersion: version,
        ttlMs: TTL_MS,
      }
    );
    if (ok !== false) return opened;
  }
  return null;
}
