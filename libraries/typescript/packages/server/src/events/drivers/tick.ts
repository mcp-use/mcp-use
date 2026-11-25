/**
 * One tick (PLAN.md §12.3.2): due jobs and pending dispatches for at most
 * 25 s, plus the sweep when its leader lease is free. Shared by the tick
 * route, the pump, `scheduled` and `server.events.process()`.
 *
 * @internal
 */

import type { TickReport } from "../types.js";

/** Default tick budget. */
export const TICK_BUDGET_MS = 25_000;

/** What a tick runs. */
export interface TickDeps {
  /** Due jobs and dispatches within the budget. */
  process: (budgetMs: number) => Promise<TickReport>;
  /** Sweep if the leader lease is free; returns records expired. */
  sweep?: () => Promise<{ expired: number }>;
}

/** Tick counters for health (`ticks: {count, last}`). */
export interface TickCounters {
  count: number;
  last: string | null;
}

/**
 * Run one tick and update counters.
 *
 * @param deps - Process and sweep.
 * @param counters - Mutated: count and last.
 * @param budgetMs - Default 25 000.
 */
export async function runTick(
  deps: TickDeps,
  counters?: TickCounters,
  budgetMs = TICK_BUDGET_MS
): Promise<TickReport> {
  const report = await deps.process(budgetMs);
  let expired = report.expired;
  if (deps.sweep !== undefined) expired += (await deps.sweep()).expired;
  if (counters !== undefined) {
    counters.count += 1;
    counters.last = new Date().toISOString();
  }
  return { ...report, expired };
}
