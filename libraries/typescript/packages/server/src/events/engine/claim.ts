/**
 * Claims (PLAN.md §8.10.1): a CAS write of `lease {owner, until}` on the job
 * record that also moves its `due` score to `until`, so a held job is never
 * overdue for the wake scheduler (D63). Unknown kinds are never claimed; a due
 * member whose job is missing is removed from `due`.
 *
 * @internal
 */

import type { EventsJob } from "../internal/records.js";
import {
  readJob,
  writeJob,
  type EngineContext,
  type StoredJob,
} from "./jobs.js";

/** Result of a claim attempt. */
export type ClaimResult =
  | { claimed: true; stored: StoredJob }
  | { claimed: false; why: "missing" | "unknown" | "held" | "kind" | "race" };

/**
 * Claim one job for this instance.
 *
 * @param kinds - Restrict to these kinds (others are left alone).
 */
export async function claimJob(
  ctx: EngineContext,
  jobId: string,
  kinds?: readonly EventsJob["kind"][]
): Promise<ClaimResult> {
  const got = await readJob(ctx, jobId);
  if (got === undefined) {
    await ctx.storage.indexRemove(ctx.keys.due(), jobId);
    return { claimed: false, why: "missing" };
  }
  if (got === "unknown") return { claimed: false, why: "unknown" };
  const now = ctx.clock.now();
  const { job } = got;
  if (kinds && !kinds.includes(job.kind))
    return { claimed: false, why: "kind" };
  if (job.lease && job.lease.until > now && job.lease.owner !== ctx.owner)
    return { claimed: false, why: "held" };
  const until = now + ctx.config.leaseMs;
  const next = { ...job, lease: { owner: ctx.owner, until } } as EventsJob;
  const version = await writeJob(ctx, next, got.version);
  if (version === false) return { claimed: false, why: "race" };
  await ctx.storage.indexAdd(ctx.keys.due(), jobId, until);
  return { claimed: true, stored: { job: next, version } };
}

/**
 * Release a claimed job, rescheduling it at `at` (or parking it out of `due`
 * when `at` is null). Writes the job without its lease.
 */
export async function releaseJob(
  ctx: EngineContext,
  stored: StoredJob,
  at: number | null
): Promise<StoredJob | null> {
  const { lease: _lease, ...rest } = stored.job;
  const next = rest as EventsJob;
  if ("nextAt" in next && at !== null) next.nextAt = at;
  const version = await writeJob(ctx, next, stored.version);
  if (version === false) return null;
  if (at === null) await ctx.storage.indexRemove(ctx.keys.due(), next.id);
  else await ctx.storage.indexAdd(ctx.keys.due(), next.id, at);
  return { job: next, version };
}
