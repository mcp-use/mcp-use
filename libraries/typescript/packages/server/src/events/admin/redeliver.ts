/**
 * `redeliver` (D74): re-enqueue an abandoned deliver or control job with the
 * same body and `webhook-id`, marked `redelivery` so it bypasses inflight.
 *
 * @internal
 */

import { EventsConfigError } from "../errors.js";
import type { DeadLetter, EventsJob } from "../internal/records.js";
import type { ViewContext } from "./views.js";

/**
 * Re-enqueue one dead letter at `now`.
 *
 * @param ctx - Storage, keys and codec.
 * @param id - Dead-letter id (the abandoned job id).
 * @param now - Current time in ms.
 */
export async function redeliverDeadLetter(
  ctx: ViewContext,
  id: string,
  now: number
): Promise<{ jobId: string }> {
  const key = ctx.keys.deadLetter(id);
  const stored = await ctx.storage.read(key);
  if (stored === undefined)
    throw new EventsConfigError(
      "EVENTS_CONFIG_INVALID",
      `events admin: dead letter ${id} not found.`,
      { field: "deadLetterId", notFound: true }
    );
  const d = (await ctx.codec.open(key, stored.value)) as DeadLetter;
  const old = d.job;
  if (old.kind !== "deliver" && old.kind !== "control")
    throw new EventsConfigError(
      "EVENTS_CONFIG_INVALID",
      `events admin: dead letter ${id} is not a deliver or control job.`,
      { field: "deadLetterId" }
    );
  const { lease: _lease, ...rest } = old;
  void _lease;
  const job = {
    ...rest,
    attempt: 0,
    firstAttemptAt: null,
    lastAttemptAt: null,
    pausedMs: 0,
    nextAt: now,
    createdAt: now,
    maxAgeAt: now + (old.maxAgeAt - old.createdAt),
    ...(old.kind === "deliver" ? { redelivery: true as const } : {}),
  } as EventsJob;
  const jobKey = ctx.keys.job(job.id);
  await ctx.storage.write(jobKey, await ctx.codec.seal(jobKey, job), {
    ttlMs: 7 * 24 * 3_600_000,
  });
  await ctx.storage.indexAdd(ctx.keys.due, job.id, now);
  await ctx.storage.remove(key);
  await ctx.storage.indexRemove(ctx.keys.dead, id);
  return { jobId: job.id };
}
