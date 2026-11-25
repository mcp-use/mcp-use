/**
 * Dead letters (D74): an abandoned `deliver` or `control` job is kept as
 * `ev:{ns}:dead:{jobId}` indexed by `idx ev:{ns}:dead`, for
 * `retry.deadLetterTtl` (0 disables). Redelivery re-enqueues the same body
 * and `webhook-id` with a fresh schedule, marked `redelivery: true`, and
 * bypasses `inflight` so watermarks stay monotonic.
 *
 * @internal
 */

import type { DeadLetter, EventsJob } from "../internal/records.js";
import { enqueueJob, type EngineContext } from "./jobs.js";
import { newSchedule } from "./schedule.js";

/** Write a dead letter for an abandoned job (no-op when the TTL is 0). */
export async function writeDeadLetter(
  ctx: EngineContext,
  job: EventsJob,
  reason: DeadLetter["reason"]
): Promise<void> {
  if (ctx.config.deadLetterTtlMs <= 0) return;
  if (job.kind !== "deliver" && job.kind !== "control") return;
  const at = ctx.clock.now();
  const { lease: _l, ...clean } = job;
  const record: DeadLetter = { v: 1, job: clean as EventsJob, reason, at };
  await ctx.storage.write(
    ctx.keys.dead(job.id),
    await ctx.codec.encode(record),
    { ttlMs: ctx.config.deadLetterTtlMs }
  );
  await ctx.storage.indexAdd(ctx.keys.deadIdx(), job.id, at);
  ctx.log({
    type: "dead_letter",
    ...("subscriptionId" in job ? { subscription: job.subscriptionId } : {}),
    reason,
  });
}

/** Read one dead letter. */
export async function readDeadLetter(
  ctx: EngineContext,
  jobId: string
): Promise<DeadLetter | undefined> {
  const got = await ctx.storage.read(ctx.keys.dead(jobId));
  return got ? ctx.codec.decode<DeadLetter>(got.value) : undefined;
}

/** List dead letters, oldest first; drops index members whose record expired. */
export async function listDeadLetters(
  ctx: EngineContext,
  o: { limit: number; after?: string | undefined }
): Promise<{ items: DeadLetter[]; next?: string }> {
  const page = await ctx.storage.indexRange(ctx.keys.deadIdx(), {
    limit: o.limit,
    ...(o.after ? { after: o.after } : {}),
  });
  const items: DeadLetter[] = [];
  for (const { member } of page.items) {
    const d = await readDeadLetter(ctx, member);
    if (d) items.push(d);
    else await ctx.storage.indexRemove(ctx.keys.deadIdx(), member);
  }
  return page.next ? { items, next: page.next } : { items };
}

/**
 * Re-enqueue a dead letter with a fresh schedule, the same body and
 * `webhook-id`, `redelivery: true`, outside `inflight`.
 *
 * @returns The redelivered job id, or null when no such dead letter exists.
 */
export async function redeliverDeadLetter(
  ctx: EngineContext,
  jobId: string
): Promise<string | null> {
  const d = await readDeadLetter(ctx, jobId);
  if (!d) return null;
  const now = ctx.clock.now();
  const job = {
    ...d.job,
    ...newSchedule(ctx.config, ctx.clock, now),
    createdAt: now,
    redelivery: true,
  } as EventsJob;
  await ctx.storage.remove(ctx.keys.job(job.id));
  await enqueueJob(ctx, job, now);
  await ctx.storage.remove(ctx.keys.dead(jobId));
  await ctx.storage.indexRemove(ctx.keys.deadIdx(), jobId);
  ctx.log({
    type: "redeliver",
    ...("subscriptionId" in job ? { subscription: job.subscriptionId } : {}),
    reason: d.reason,
  });
  return job.id;
}
