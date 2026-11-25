/**
 * Hook jobs (PLAN.md §8.10.1): run `onUnsubscribe(info, reason)` at least
 * once on the D20 schedule. A throwing hook is retried and, when exhausted,
 * logged `hook_failed` (no dead letter: hooks are app work). Enqueued only
 * for events whose definition has `onUnsubscribe`.
 *
 * @internal
 */

import type { UnsubscribeReason } from "../types.js";
import type { HookJob, SubscriptionInfoSnapshot } from "../internal/records.js";
import { releaseJob } from "./claim.js";
import {
  enqueueJob,
  hookJobId,
  settleJob,
  type EngineContext,
  type StoredJob,
} from "./jobs.js";
import { newSchedule, nextAttempt } from "./schedule.js";

/**
 * Enqueue a hook job for a removed subscription or lease.
 *
 * @returns The job id, or null when the event has no `onUnsubscribe`.
 */
export async function enqueueHook(
  ctx: EngineContext,
  snapshot: SubscriptionInfoSnapshot,
  reason: UnsubscribeReason
): Promise<string | null> {
  const ev = ctx.registry.get(snapshot.name);
  if (!ev?.hooks.onUnsubscribe) return null;
  const now = ctx.clock.now();
  const job: HookJob = {
    v: 1,
    id: await hookJobId(snapshot.id, reason, snapshot.expiresAt),
    createdAt: now,
    ...newSchedule(ctx.config, ctx.clock, now),
    kind: "hook",
    reason,
    subscription: snapshot,
  };
  await enqueueJob(ctx, job, now);
  return job.id;
}

/** Run one claimed hook job. */
export async function runHookJob(
  ctx: EngineContext,
  stored: StoredJob<HookJob>
): Promise<"done" | "retry" | "failed" | "dropped"> {
  const job = stored.job;
  const ev = ctx.registry.get(job.subscription.name);
  if (!ev) {
    await settleJob(ctx, job.id, null);
    return "dropped";
  }
  const now = ctx.clock.now();
  job.attempt += 1;
  job.firstAttemptAt ??= now;
  job.lastAttemptAt = now;
  try {
    const s = job.subscription;
    await ev.runOnUnsubscribe(
      {
        id: s.id,
        name: s.name,
        args: s.args,
        principal: s.principal,
        dialect: s.dialect,
        mode: s.mode,
        callbackOrigin: s.callbackOrigin,
        expiresAt: s.expiresAt === null ? null : new Date(s.expiresAt),
        created: false,
      },
      job.reason
    );
    await settleJob(ctx, job.id, null);
    return "done";
  } catch (err) {
    const next = nextAttempt(job, ctx.config, ctx.clock.now());
    if ("exhausted" in next) {
      await settleJob(ctx, job.id, null);
      ctx.log({
        type: "abandon",
        subscription: job.subscription.id,
        name: job.subscription.name,
        reason: `hook_failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return "failed";
    }
    await releaseJob(ctx, stored, next.at);
    return "retry";
  }
}
