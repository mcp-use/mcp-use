/**
 * Webhook runner (PLAN.md §9.5.2, §9.5.3): subscribe, refresh at
 * 0.75 × (refreshBefore − now) ±5 %, storm guard, 30-day secret rotation,
 * receiver URL changes. Deliveries arrive through the manager's receiver.
 *
 * @internal
 */

import { generateWebhookSecret } from "@mcp-use/events-core";
import { EventsClientError } from "../types.js";
import {
  backoffMs,
  classifyFailure,
  sleep,
  type RunnerContext,
  type RunnerExit,
} from "./poll.js";

/** More than this many refreshes in {@link STORM_WINDOW_MS} trips the guard. */
export const STORM_MAX_REFRESHES = 6;
/** Storm guard window and back-off. */
export const STORM_WINDOW_MS = 60_000;
/** Secret rotation period. */
export const SECRET_ROTATION_MS = 30 * 24 * 3_600_000;
/** How long the previous secret stays valid after rotation. */
export const PREVIOUS_SECRET_GRACE_MS = 24 * 3_600_000;

/** Options of {@link runWebhook}. */
export interface WebhookRunnerOptions {
  /** The receiver URL to subscribe. */
  receiverUrl: string;
  /** Requested TTL. */
  ttlMs?: number;
  /** Replay floor for the first request. */
  maxAgeMs?: number;
  /** Called with the receiver URL that is current at each refresh. */
  currentReceiverUrl?: () => string;
}

/**
 * Compute the next refresh delay.
 *
 * @param refreshBefore - ISO deadline or null (never refresh).
 * @param now - Epoch ms.
 * @param random - Random source.
 * @returns Delay in ms, or `undefined` for no refresh.
 */
export function refreshDelayMs(
  refreshBefore: string | null,
  now: number,
  random = Math.random
): number | undefined {
  if (refreshBefore === null) return undefined;
  const deadline = Date.parse(refreshBefore);
  if (!Number.isFinite(deadline)) return undefined;
  const base = 0.75 * (deadline - now);
  const jitter = 1 + (random() * 2 - 1) * 0.05;
  return Math.max(1_000, Math.floor(base * jitter));
}

/**
 * Run the webhook subscription until stopped or terminated.
 *
 * @param ctx - Runner context.
 * @param opts - Receiver URL, TTL and replay floor.
 * @returns How the runner stopped.
 */
export async function runWebhook(
  ctx: RunnerContext,
  opts: WebhookRunnerOptions
): Promise<RunnerExit> {
  const now = ctx.now ?? Date.now;
  const random = ctx.random ?? Math.random;
  const refreshes: number[] = [];
  let attempt = 0;
  let first = true;
  let suspendedReported = false;

  while (!ctx.signal.aborted) {
    const record = ctx.record;
    const url = opts.currentReceiverUrl?.() ?? opts.receiverUrl;
    const t = now();

    // Secret rotation every 30 days.
    if (
      !record.webhook ||
      t - Date.parse(record.webhook.secretRotatedAt) >= SECRET_ROTATION_MS
    ) {
      const secret = generateWebhookSecret();
      record.webhook = {
        receiverUrl: url,
        subscriptionId: record.webhook?.subscriptionId ?? "",
        secret,
        ...(record.webhook ? { previousSecret: record.webhook.secret } : {}),
        secretRotatedAt: new Date(t).toISOString(),
        refreshBefore: record.webhook?.refreshBefore ?? null,
      };
      await ctx.persist();
    } else if (
      record.webhook.previousSecret &&
      t - Date.parse(record.webhook.secretRotatedAt) > PREVIOUS_SECRET_GRACE_MS
    ) {
      delete record.webhook.previousSecret;
    }

    // Storm guard.
    while (refreshes.length && t - refreshes[0]! > STORM_WINDOW_MS) {
      refreshes.shift();
    }
    if (refreshes.length >= STORM_MAX_REFRESHES) {
      ctx.error(
        new EventsClientError(
          "refresh_storm",
          `More than ${STORM_MAX_REFRESHES} refreshes in 60 s`,
          { server: record.server, name: record.name }
        )
      );
      refreshes.length = 0;
      await sleep(STORM_WINDOW_MS, ctx.signal);
      continue;
    }
    refreshes.push(t);

    let wait: number | undefined;
    try {
      const conn = await ctx.connection();
      const oldUrl = record.webhook.receiverUrl;
      const maxAgeMs = first ? (opts.maxAgeMs ?? record.maxAgeMs) : undefined;
      const result = await conn.subscribeEvent(
        {
          name: record.name,
          arguments: record.args,
          delivery: { mode: "webhook", url, secret: record.webhook.secret },
          cursor: record.cursor,
          ...(maxAgeMs !== undefined && record.cursor === null
            ? { maxAgeMs }
            : {}),
          ...(opts.ttlMs !== undefined ? { ttlMs: opts.ttlMs } : {}),
        },
        { signal: ctx.signal }
      );
      first = false;
      attempt = 0;
      record.webhook.subscriptionId = result.id;
      record.webhook.receiverUrl = url;
      record.webhook.refreshBefore = result.refreshBefore;
      if (result.truncated) {
        ctx.gap({ cursor: result.cursor, reason: "truncated" });
      }
      if (result.cursor !== null) record.cursor = result.cursor;
      await ctx.persist();
      if (oldUrl !== url && oldUrl) {
        // Receiver URL changed: the new subscription carries the cursor; drop the old.
        await conn
          .unsubscribeEvent({
            name: record.name,
            arguments: record.args,
            delivery: { mode: "webhook", url: oldUrl },
          })
          .catch(() => undefined);
      }
      if (result.deliveryStatus && result.deliveryStatus.active === false) {
        if (!suspendedReported) {
          suspendedReported = true;
          ctx.error(
            new EventsClientError(
              "delivery_suspended",
              "The server reported the webhook delivery as suspended",
              {
                server: record.server,
                name: record.name,
                ...(result.deliveryStatus.retryAfterMs !== undefined
                  ? {
                      data: {
                        retryAfterMs: result.deliveryStatus.retryAfterMs,
                      },
                    }
                  : {}),
              }
            )
          );
        }
      } else {
        suspendedReported = false;
      }
      wait = refreshDelayMs(result.refreshBefore, now(), random);
      if (wait === undefined) {
        // No expiry: wait until stopped, or until the receiver URL changes.
        while (!ctx.signal.aborted) {
          await sleep(1_000, ctx.signal);
          if ((opts.currentReceiverUrl?.() ?? url) !== url) break;
        }
        continue;
      }
    } catch (err) {
      if (ctx.signal.aborted) break;
      const f = classifyFailure(err);
      if (f.action === "terminal") {
        ctx.terminate(f.termination);
        return { kind: "terminated" };
      }
      if (f.action === "auth") return { kind: "auth" };
      wait = f.action === "wait" ? f.ms : backoffMs(attempt++, random);
    }
    await sleep(wait, ctx.signal);
  }
  return { kind: "stopped" };
}

/**
 * Unsubscribe a webhook record (NotFound counts as success).
 *
 * @param ctx - Runner context (only `connection` and `record` are used).
 */
export async function cancelWebhook(
  ctx: Pick<RunnerContext, "connection" | "record">
): Promise<void> {
  const w = ctx.record.webhook;
  if (!w) return;
  const conn = await ctx.connection();
  await conn.unsubscribeEvent({
    name: ctx.record.name,
    arguments: ctx.record.args,
    delivery: { mode: "webhook", url: w.receiverUrl },
  });
}
