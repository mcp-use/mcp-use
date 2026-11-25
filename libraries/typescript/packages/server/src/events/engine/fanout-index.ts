/**
 * Fan-out indexes (one per subscription): unpartitioned subscriptions live in
 * `by-name:{n}`, partitioned ones in `by-name:{n}:p:{h}` and the wildcard
 * group `by-name:{n}:p:*`. The dispatcher pages one group at a time.
 *
 * @internal
 */

import type { SubscriptionRecord } from "../internal/records.js";
import { readSubscription } from "./attempt.js";
import type { EngineContext } from "./jobs.js";

/** A fan-out group of one event name. */
export type FanoutGroup = "unpartitioned" | "p:*" | { partition: string };

/** The index key of a group. */
export function groupIndex(
  ctx: EngineContext,
  name: string,
  group: FanoutGroup
): string {
  if (group === "unpartitioned") return ctx.keys.byName(name);
  if (group === "p:*") return ctx.keys.byNamePartitioned(name);
  return ctx.keys.byNamePartition(name, group.partition);
}

/** Groups an entry with `partition` fans out to, in order. */
export function groupsFor(partition: string | null): FanoutGroup[] {
  return partition === null
    ? ["unpartitioned", "p:*"]
    : ["unpartitioned", { partition }];
}

/** Serialize a group for the fan-out state. */
export function groupKey(g: FanoutGroup): string {
  return typeof g === "string" ? g : `p:${g.partition}`;
}

/** Parse a serialized group. */
export function parseGroup(s: string): FanoutGroup {
  if (s === "unpartitioned" || s === "p:*") return s;
  return { partition: s.slice(2) };
}

/** Add a subscription to the fan-out index of its group. */
export async function indexSubscription(
  ctx: EngineContext,
  sub: Pick<SubscriptionRecord, "id" | "name" | "partition" | "createdAt">
): Promise<void> {
  const g: FanoutGroup =
    sub.partition === null ? "unpartitioned" : { partition: sub.partition };
  await ctx.storage.indexAdd(
    groupIndex(ctx, sub.name, g),
    sub.id,
    sub.createdAt,
    {
      onlyIfAbsent: true,
    }
  );
  if (sub.partition !== null)
    await ctx.storage.indexAdd(
      groupIndex(ctx, sub.name, "p:*"),
      sub.id,
      sub.createdAt,
      {
        onlyIfAbsent: true,
      }
    );
}

/** Page subscriptions of a group; drops members whose record is gone. */
export async function pageSubscriptions(
  ctx: EngineContext,
  name: string,
  group: FanoutGroup,
  o: { after?: string | undefined; limit: number }
): Promise<{ items: SubscriptionRecord[]; next?: string }> {
  const index = groupIndex(ctx, name, group);
  const page = await ctx.storage.indexRange(index, {
    limit: o.limit,
    ...(o.after ? { after: o.after } : {}),
  });
  const items: SubscriptionRecord[] = [];
  for (const { member } of page.items) {
    const sub = await readSubscription(ctx, member);
    if (sub) items.push(sub);
    else await ctx.storage.indexRemove(index, member);
  }
  return page.next ? { items, next: page.next } : { items };
}
