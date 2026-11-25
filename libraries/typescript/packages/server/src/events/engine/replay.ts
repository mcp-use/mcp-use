/**
 * Replay jobs (PLAN.md §8.10.4): read the log from `nextSeq`, apply targeting
 * and `match`, create deliver jobs through the dispatcher's function, advance
 * the provisional marker `r.{id}` in `inflight:{id}`, and remove it at
 * `toSeq`. Paced: new jobs only while fewer than 50 deliveries are unsettled.
 *
 * @internal
 */

import type { LogValue, ReplayJob } from "../internal/records.js";
import { readSubscription } from "./attempt.js";
import { releaseJob } from "./claim.js";
import { createDeliver, entryMatches } from "./dispatcher.js";
import { markGapPending } from "./gap.js";
import {
  enqueueJob,
  settleJob,
  type EngineContext,
  type StoredJob,
} from "./jobs.js";

/** Marker id of a subscription's replay. */
export function replayMarker(subscriptionId: string): string {
  return `r.${subscriptionId}`;
}

/** Enqueue the replay job of `(fromSeq, toSeq]` and place its marker. */
export async function enqueueReplay(
  ctx: EngineContext,
  subscriptionId: string,
  epoch: string,
  fromSeq: number,
  toSeq: number
): Promise<void> {
  const now = ctx.clock.now();
  await ctx.storage.indexAdd(
    ctx.keys.inflight(subscriptionId),
    replayMarker(subscriptionId),
    fromSeq + 1
  );
  const job: ReplayJob = {
    v: 1,
    id: replayMarker(subscriptionId),
    createdAt: now,
    kind: "replay",
    subscriptionId,
    epoch,
    nextSeq: fromSeq + 1,
    toSeq,
  };
  await enqueueJob(ctx, job, now);
}

/** Run one claimed replay job for at most one page. */
export async function runReplayJob(
  ctx: EngineContext,
  stored: StoredJob<ReplayJob>,
  o: { page?: number } = {}
): Promise<"done" | "progress" | "paced" | "dropped"> {
  const job = stored.job;
  const inflight = ctx.keys.inflight(job.subscriptionId);
  const marker = replayMarker(job.subscriptionId);
  const sub = await readSubscription(ctx, job.subscriptionId);
  if (!sub) {
    await settleJob(ctx, job.id, job.subscriptionId);
    return "dropped";
  }
  const unsettled = (await ctx.storage.indexCount(inflight)) - 1;
  const room = ctx.config.replayPacingUnsettled - unsettled;
  if (room <= 0) {
    await releaseJob(ctx, stored, ctx.clock.now() + 1000);
    return "paced";
  }
  const read = await ctx.storage.logRange(ctx.keys.log(sub.name), {
    after: job.nextSeq - 1,
    limit: Math.min(room, o.page ?? 100),
  });
  if (read.epoch !== job.epoch || read.first > job.nextSeq) {
    await markGapPending(ctx, sub);
    if (read.epoch !== job.epoch) {
      await finish(ctx, job, inflight, marker);
      return "done";
    }
    job.nextSeq = Math.max(job.nextSeq, read.first);
  }
  for (const e of read.entries) {
    if (e.seq > job.toSeq) break;
    const value = await ctx.codec.decode<LogValue>(e.value);
    if (value.k === "e") {
      const entry = { epoch: job.epoch, seq: e.seq, value };
      if (await entryMatches(ctx, sub, entry))
        await createDeliver(ctx, sub, entry);
    }
    job.nextSeq = e.seq + 1;
  }
  if (job.nextSeq > job.toSeq || read.entries.length === 0) {
    await finish(ctx, job, inflight, marker);
    return "done";
  }
  await ctx.storage.indexAdd(inflight, marker, job.nextSeq);
  await releaseJob(ctx, stored, ctx.clock.now());
  return "progress";
}

async function finish(
  ctx: EngineContext,
  job: ReplayJob,
  inflight: string,
  marker: string
): Promise<void> {
  await ctx.storage.indexRemove(inflight, marker);
  await ctx.storage.indexRemove(ctx.keys.due(), job.id);
  await ctx.storage.remove(ctx.keys.job(job.id));
}
