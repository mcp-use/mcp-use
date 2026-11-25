/**
 * `process({kinds?, budgetMs?})` → `TickReport` (PLAN.md §8.17): runs due
 * dispatchers from `idx fanout-due` and due jobs from `idx due` until the
 * budget runs out. Unknown job kinds are never claimed.
 *
 * @internal
 */

import type { EventsJob } from "../internal/records.js";
import type { TickReport } from "../types.js";
import { attemptJob } from "./attempt.js";
import { claimJob } from "./claim.js";
import { dispatchName } from "./dispatcher.js";
import { runHookJob } from "./hooks.js";
import type { EngineContext, StoredJob } from "./jobs.js";
import { runReplayJob } from "./replay.js";

/** Options of {@link processDue}. */
export interface ProcessOptions {
  /** Only these job kinds (dispatchers always run unless `kinds` excludes "fanout"). */
  kinds?: readonly (EventsJob["kind"] | "fanout")[];
  /** Time budget in ms (default 25 s). */
  budgetMs?: number;
}

/** Run one claimed job of a known kind. */
export async function runJob(
  ctx: EngineContext,
  stored: StoredJob
): Promise<void> {
  const job = stored.job;
  switch (job.kind) {
    case "deliver":
    case "control":
      await attemptJob(ctx, stored as StoredJob<typeof job>);
      return;
    case "hook":
      await runHookJob(ctx, stored as StoredJob<typeof job>);
      return;
    case "replay":
      await runReplayJob(ctx, stored as StoredJob<typeof job>);
      return;
    default:
      // Unknown kinds are never claimed (layout rule 3).
      return;
  }
}

/** Process one job by id (claims it first). */
export async function processJob(
  ctx: EngineContext,
  jobId: string,
  kinds?: readonly EventsJob["kind"][]
): Promise<boolean> {
  const c = await claimJob(ctx, jobId, kinds);
  if (!c.claimed) return false;
  await runJob(ctx, c.stored);
  return true;
}

/** Process due work until none is due or the budget is spent. */
export async function processDue(
  ctx: EngineContext,
  o: ProcessOptions = {}
): Promise<TickReport> {
  const start = ctx.clock.now();
  const budget = o.budgetMs ?? 25_000;
  const jobKinds = o.kinds?.filter(
    (k): k is EventsJob["kind"] => k !== "fanout"
  );
  const runFanout = !o.kinds || o.kinds.includes("fanout");
  let attempted = 0;
  const skipped = new Set<string>();
  for (;;) {
    if (ctx.clock.now() - start >= budget) break;
    let progressed = false;
    const now = ctx.clock.now();
    if (runFanout) {
      const names = await ctx.storage.indexRange(ctx.keys.fanoutDue(), {
        max: now,
        limit: 20,
      });
      for (const { member } of names.items) {
        if (skipped.has(`f:${member}`)) continue;
        const r = await dispatchName(ctx, member);
        if (r.ran) {
          attempted++;
          progressed = true;
        } else skipped.add(`f:${member}`);
      }
    }
    const due = await ctx.storage.indexRange(ctx.keys.due(), {
      max: now,
      limit: 50,
    });
    for (const { member } of due.items) {
      if (skipped.has(member)) continue;
      if (ctx.clock.now() - start >= budget) break;
      if (await processJob(ctx, member, jobKinds)) {
        attempted++;
        progressed = true;
      } else skipped.add(member);
    }
    if (!progressed) break;
  }
  const now = ctx.clock.now();
  const remaining =
    (await ctx.storage.indexCount(ctx.keys.due(), { max: now })) +
    (await ctx.storage.indexCount(ctx.keys.fanoutDue(), { max: now }));
  return {
    attempted,
    expired: 0,
    remaining,
    nextWakeAt: await nextWakeAt(ctx),
  };
}

/** min(first score of idx due, first score of idx fanout-due), or null (D63). */
export async function nextWakeAt(ctx: EngineContext): Promise<string | null> {
  const [a, b] = await Promise.all([
    ctx.storage.indexRange(ctx.keys.due(), { limit: 1 }),
    ctx.storage.indexRange(ctx.keys.fanoutDue(), { limit: 1 }),
  ]);
  const scores = [a.items[0]?.score, b.items[0]?.score].filter(
    (s): s is number => s !== undefined
  );
  return scores.length ? new Date(Math.min(...scores)).toISOString() : null;
}
