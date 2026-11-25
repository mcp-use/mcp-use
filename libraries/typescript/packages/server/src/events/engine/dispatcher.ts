/**
 * The per-name dispatcher (PLAN.md §8.9, §8.10.3): lease `lock:fanout:{n}`,
 * pointer `fanout:{n}`, `fanout-due` score moved to the lease expiry; batch
 * read after the pointer; one fan-out index per subscription; auto-match or
 * `match`; deliver jobs put-if-absent in `seq` order with the body serialized
 * once per subscription.
 *
 * @internal
 */

import { isProfileAxes } from "@mcp-use/events-core";
import type {
  DeliverJob,
  FanoutState,
  LogValue,
  SubscriptionRecord,
} from "../internal/records.js";
import { pageSubscriptions, groupsFor } from "./fanout-index.js";
import { markGapPending } from "./gap.js";
import { deliverJobId, writeJob, type EngineContext } from "./jobs.js";
import { newSchedule } from "./schedule.js";
import {
  byteLength,
  eventWebhookId,
  normalizeEventId,
  serializeEventBody,
} from "./shape.js";
import { updateStatus } from "./suspension.js";
import { lowestInflight, readFanoutState } from "./watermark.js";

/** One event log entry as the dispatcher sees it. */
export interface DispatchEntry {
  epoch: string;
  seq: number;
  value: Extract<LogValue, { k: "e" }>;
}

/** Why a deliver job was not created. */
export type CreateDeliverResult =
  | "created"
  | "exists"
  | "oversize"
  | "pending_overflow"
  | "profile_unknown";

/** Whether an entry targets a subscription (`to` principals/subscription). */
export function targets(
  to: { principals?: string[]; subscriptionId?: string } | undefined,
  sub: Pick<SubscriptionRecord, "id" | "principal">
): boolean {
  if (!to) return true;
  if (to.subscriptionId !== undefined && to.subscriptionId !== sub.id)
    return false;
  if (to.principals !== undefined && !to.principals.includes(sub.principal))
    return false;
  return true;
}

/** Whether an entry matches a subscription (targeting, partition, match). */
export async function entryMatches(
  ctx: EngineContext,
  sub: SubscriptionRecord,
  entry: DispatchEntry
): Promise<boolean> {
  if (!targets(entry.value.to, sub)) return false;
  if (sub.partition !== null && entry.value.partition !== sub.partition)
    return false;
  const ev = ctx.registry.get(sub.name);
  if (!ev) return false;
  try {
    return await ev.match(sub.args, entry.value.data, {
      principal: sub.principal,
      subscriptionId: sub.id,
      dialect: sub.profile.preset,
      mode: "webhook",
    });
  } catch {
    return false;
  }
}

/**
 * Create the deliver job of `entry` for `sub` (§8.10.3 steps 1–6). Safe to
 * redo after a crash: an existing job keeps its scores.
 */
export async function createDeliver(
  ctx: EngineContext,
  sub: SubscriptionRecord,
  entry: DispatchEntry
): Promise<CreateDeliverResult> {
  if (!isProfileAxes(sub.profile.axes)) {
    ctx.log({
      type: "profile_unknown",
      subscription: sub.id,
      preset: sub.profile.preset,
      revision: sub.profile.revision,
    });
    return "profile_unknown";
  }
  const axes = sub.profile.axes;
  const ev = ctx.registry.get(sub.name);
  const replayable =
    ev !== undefined && ev.replay !== false && axes.replayCursors;
  const inflight = ctx.keys.inflight(sub.id);

  // 1–2. Body cursor: c(seq) when oldest unsettled, else the watermark.
  let cursor: string | null = null;
  if (replayable && ctx.cursor) {
    const m = await lowestInflight(ctx, sub.id);
    const pos = m === null || m >= entry.seq ? entry.seq : m - 1;
    cursor = await ctx.cursor(entry.epoch, Math.max(0, pos));
  }

  // 3. Serialize once.
  const eventId = await normalizeEventId(entry.value.id, axes);
  const body = serializeEventBody({
    eventId,
    name: sub.name,
    timestamp: entry.value.ts,
    data: entry.value.data,
    cursor,
    meta: entry.value.meta,
  });
  const bodyBytes = byteLength(body);
  if (bodyBytes > ctx.config.maxEnvelopeBytes) {
    await markGapPending(ctx, sub);
    await updateStatus(ctx, sub.id, (s) => {
      s.lastError = "http_4xx";
    });
    ctx.log({
      type: "oversize",
      subscription: sub.id,
      name: sub.name,
      reason: `${bodyBytes}`,
    });
    return "oversize";
  }

  const jobId = await deliverJobId(sub.id, entry.value.id);
  const existing = await ctx.storage.read(ctx.keys.job(jobId));
  if (!existing) {
    // 4. Pending cap.
    const pending = await ctx.storage.indexCount(inflight);
    if (pending >= ctx.config.maxPendingPerSubscription) {
      await markGapPending(ctx, sub);
      ctx.log({
        type: "pending_overflow",
        name: sub.name,
        subscription: sub.id,
        pending,
      });
      return "pending_overflow";
    }
  }

  // 5. Put-if-absent.
  const now = ctx.clock.now();
  const job: DeliverJob = {
    v: 1,
    id: jobId,
    createdAt: now,
    ...newSchedule(ctx.config, ctx.clock, now),
    kind: "deliver",
    subscriptionId: sub.id,
    epoch: entry.epoch,
    seq: entry.seq,
    eventId: entry.value.id,
    webhookId: eventWebhookId(eventId, axes),
    body,
    bodyBytes,
  };
  const created = existing ? false : (await writeJob(ctx, job, null)) !== false;

  // 6. Repair only missing members; never change an existing score.
  await ctx.storage.indexAdd(inflight, jobId, entry.seq, {
    onlyIfAbsent: true,
  });
  await ctx.storage.indexAdd(ctx.keys.due(), jobId, now, {
    onlyIfAbsent: true,
  });
  return created ? "created" : "exists";
}

/** Result of one dispatcher run. */
export interface DispatchResult {
  ran: boolean;
  matched: number;
  jobs: number;
  through: number;
  /** More log entries remain after this batch. */
  more: boolean;
}

/** Options of {@link dispatchName}. */
export interface DispatchOptions {
  /** Log entries per batch (default 100). */
  batch?: number;
  /** Subscriptions per page (default 200). */
  pageSize?: number;
}

/**
 * Run the dispatcher of one event name once: take the lease, read the next
 * batch after the pointer, fan out, advance the pointer, reschedule.
 */
export async function dispatchName(
  ctx: EngineContext,
  name: string,
  o: DispatchOptions = {}
): Promise<DispatchResult> {
  const started = ctx.clock.now();
  const lockKey = ctx.keys.lockFanout(name);
  const until = started + ctx.config.leaseMs;
  const lock = await ctx.storage.write(lockKey, ctx.owner, {
    ifVersion: null,
    ttlMs: ctx.config.leaseMs,
  });
  if (lock === false)
    return { ran: false, matched: 0, jobs: 0, through: 0, more: false };
  await ctx.storage.indexAdd(ctx.keys.fanoutDue(), name, until);
  let matched = 0;
  let jobs = 0;
  let pages = 0;
  try {
    const { state, version } = await readFanoutState(ctx, name);
    const batch = o.batch ?? 100;
    const range = await ctx.storage.logRange(ctx.keys.log(name), {
      after: null,
      limit: 0,
    });
    const epoch = range.epoch;
    let through = state.epoch === epoch ? state.through : 0;
    const next: FanoutState = { ...state, epoch, updatedAt: started };
    if (
      epoch !== null &&
      range.first > through + 1 &&
      range.head >= range.first
    ) {
      // Fan-out overflow: entries trimmed before they were fanned out.
      const lost = range.first - 1 - through;
      ctx.log({ type: "fanout_overflow", name, lost });
      next.lostThrough = range.first - 1;
      await markGapAll(ctx, name, o.pageSize ?? 200);
      through = range.first - 1;
    }
    const read = await ctx.storage.logRange(ctx.keys.log(name), {
      after: through,
      limit: batch,
    });
    const entries: DispatchEntry[] = [];
    for (const e of read.entries) {
      const value = await ctx.codec.decode<LogValue>(e.value);
      if (value.k === "e" && read.epoch !== null)
        entries.push({ epoch: read.epoch, seq: e.seq, value });
    }
    for (const groupOf of uniqueGroups(entries)) {
      let after: string | undefined;
      do {
        const page = await pageSubscriptions(ctx, name, groupOf, {
          after,
          limit: o.pageSize ?? 200,
        });
        pages++;
        for (const sub of page.items)
          for (const entry of entries) {
            if (
              !groupsFor(entry.value.partition).some((g) =>
                sameGroup(g, groupOf)
              )
            )
              continue;
            if (!(await entryMatches(ctx, sub, entry))) continue;
            matched++;
            if ((await createDeliver(ctx, sub, entry)) === "created") jobs++;
          }
        after = page.next;
      } while (after);
    }
    const last = read.entries[read.entries.length - 1];
    next.through = last ? last.seq : through;
    delete next.batch;
    await ctx.storage.write(ctx.keys.fanout(name), JSON.stringify(next), {
      ifVersion: version,
    });
    const more = read.head > next.through;
    if (more)
      await ctx.storage.indexAdd(ctx.keys.fanoutDue(), name, ctx.clock.now());
    else await ctx.storage.indexRemove(ctx.keys.fanoutDue(), name);
    ctx.log({
      type: "fanout",
      name,
      fromSeq: through + 1,
      toSeq: next.through,
      matched,
      jobs,
      pages,
      ms: ctx.clock.now() - started,
    });
    return { ran: true, matched, jobs, through: next.through, more };
  } finally {
    await ctx.storage.remove(lockKey);
  }
}

function sameGroup(
  a: ReturnType<typeof groupsFor>[number],
  b: ReturnType<typeof groupsFor>[number]
): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.partition === b.partition;
}

function uniqueGroups(entries: DispatchEntry[]) {
  const out: ReturnType<typeof groupsFor> = [];
  for (const e of entries)
    for (const g of groupsFor(e.value.partition))
      if (!out.some((x) => sameGroup(x, g))) out.push(g);
  return out;
}

async function markGapAll(
  ctx: EngineContext,
  name: string,
  pageSize: number
): Promise<void> {
  for (const g of ["unpartitioned", "p:*"] as const) {
    let after: string | undefined;
    do {
      const page = await pageSubscriptions(ctx, name, g, {
        after,
        limit: pageSize,
      });
      for (const sub of page.items) await markGapPending(ctx, sub);
      after = page.next;
    } while (after);
  }
}
