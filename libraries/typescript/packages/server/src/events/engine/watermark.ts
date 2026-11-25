/**
 * The derived watermark (PLAN.md §8.10.3). Read the dispatcher pointer FIRST,
 * then the lowest unsettled `inflight` position; never held in memory.
 *
 * @internal
 */

import type { FanoutState, SubscriptionRecord } from "../internal/records.js";
import type { EngineContext } from "./jobs.js";

/** Read the dispatcher pointer of `name`. */
export async function readFanoutState(
  ctx: EngineContext,
  name: string
): Promise<{ state: FanoutState; version: string | null }> {
  const got = await ctx.storage.read(ctx.keys.fanout(name));
  if (!got)
    return {
      state: { v: 1, epoch: null, through: 0, updatedAt: 0 },
      version: null,
    };
  return { state: JSON.parse(got.value) as FanoutState, version: got.version };
}

/** The lowest unsettled position of a subscription, or null. */
export async function lowestInflight(
  ctx: EngineContext,
  subscriptionId: string
): Promise<number | null> {
  const page = await ctx.storage.indexRange(ctx.keys.inflight(subscriptionId), {
    limit: 1,
  });
  return page.items[0]?.score ?? null;
}

/**
 * The watermark position `{epoch, seq}` of a subscription, or null when the
 * log has no epoch yet.
 */
export async function watermarkPosition(
  ctx: EngineContext,
  sub: Pick<SubscriptionRecord, "id" | "name" | "start">
): Promise<{ epoch: string; seq: number } | null> {
  const { state } = await readFanoutState(ctx, sub.name); // FIRST
  const m = await lowestInflight(ctx, sub.id); // SECOND
  const epoch = state.epoch ?? sub.start?.epoch ?? null;
  if (epoch === null) return null;
  let w = m !== null ? m - 1 : state.through;
  if (sub.start && sub.start.epoch === epoch) w = Math.max(w, sub.start.seq);
  return { epoch, seq: Math.max(0, w) };
}

/** The watermark cursor, or null without a cursor codec or epoch. */
export async function watermarkCursor(
  ctx: EngineContext,
  sub: Pick<SubscriptionRecord, "id" | "name" | "start">
): Promise<string | null> {
  if (!ctx.cursor) return null;
  const pos = await watermarkPosition(ctx, sub);
  return pos ? ctx.cursor(sub.name, pos.epoch, pos.seq) : null;
}
