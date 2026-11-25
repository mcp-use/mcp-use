/**
 * Gap rules (D20, PLAN.md §8.11). `gapPending` on `status:{id}` is set by
 * exhaustion, staleness, oversize, overflow and loop-guard drops; the next
 * 2xx queues `c.{id}.gap` (put-if-absent) with the watermark at creation, or
 * a refresh reports `truncated` and clears it. Never for 410, never for
 * non-replayable events, only under `replayCursors ∧ controlEnvelopes` for
 * the gap envelope.
 *
 * @internal
 */

import { generateWebhookId } from "@mcp-use/events-core";
import type { ControlJob, SubscriptionRecord } from "../internal/records.js";
import { enqueueJob, type EngineContext } from "./jobs.js";
import { newSchedule } from "./schedule.js";
import { updateStatus } from "./suspension.js";
import { watermarkCursor } from "./watermark.js";

/** Whether gaps apply to a subscription (replayable event, `replayCursors`). */
export function gapsApply(
  ctx: EngineContext,
  sub: Pick<SubscriptionRecord, "name" | "profile">
): boolean {
  const ev = ctx.registry.get(sub.name);
  return (
    ev !== undefined && ev.replay !== false && sub.profile.axes.replayCursors
  );
}

/** Set `gapPending` when gaps apply. */
export async function markGapPending(
  ctx: EngineContext,
  sub: Pick<SubscriptionRecord, "id" | "name" | "profile">
): Promise<void> {
  if (!gapsApply(ctx, sub)) return;
  await updateStatus(ctx, sub.id, (s) => {
    if (s.gapPending) return false;
    s.gapPending = true;
  });
}

/**
 * Queue a `gap` control job now (413, or the 2xx after a gap) when
 * `controlEnvelopes` is on; clears `gapPending`.
 *
 * @returns Whether a job was created.
 */
export async function queueGap(
  ctx: EngineContext,
  sub: SubscriptionRecord
): Promise<boolean> {
  if (!gapsApply(ctx, sub) || !sub.profile.axes.controlEnvelopes) return false;
  const now = ctx.clock.now();
  const cursor = await watermarkCursor(ctx, sub);
  const body = JSON.stringify({ type: "gap", cursor });
  const job: ControlJob = {
    v: 1,
    id: `c.${sub.id}.gap`,
    createdAt: now,
    ...newSchedule(ctx.config, ctx.clock, now),
    kind: "control",
    subscriptionId: sub.id,
    type: "gap",
    webhookId: generateWebhookId("gap"),
    body,
  };
  const created = await enqueueJob(ctx, job, now);
  await updateStatus(ctx, sub.id, (s) => {
    if (!s.gapPending) return false;
    s.gapPending = false;
  });
  return created;
}

/** After a 2xx: when `gapPending`, queue the gap envelope. */
export async function settleGapAfterAck(
  ctx: EngineContext,
  sub: SubscriptionRecord,
  gapPending: boolean
): Promise<void> {
  if (gapPending) await queueGap(ctx, sub);
}

/**
 * Refresh: report and clear `gapPending` (`truncated: true`) for replayable
 * events; never for non-replayable ones.
 */
export async function takeGapForRefresh(
  ctx: EngineContext,
  sub: Pick<SubscriptionRecord, "id" | "name" | "profile">
): Promise<boolean> {
  if (!gapsApply(ctx, sub)) return false;
  let was = false;
  await updateStatus(ctx, sub.id, (s) => {
    if (!s.gapPending) return false;
    was = true;
    s.gapPending = false;
  });
  return was;
}
