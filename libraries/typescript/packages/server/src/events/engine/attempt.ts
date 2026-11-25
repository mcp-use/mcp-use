/**
 * Processing a claimed `deliver` or `control` job (PLAN.md §8.10.2): stale
 * check, subscription checks, start check, park, breaker, throttle,
 * concurrency, sign, POST, classify and settle (§8.11). Also the attempt log
 * `log ev:{ns}:attempts:{id}` (20 entries, no bodies).
 *
 * @internal
 */

import {
  parseWebhookSecret,
  signWebhook,
  WEBHOOK_HEADERS,
  type DeliveryErrorCategory,
} from "@mcp-use/events-core";
import type {
  AttemptRecord,
  ControlJob,
  DeliverJob,
  SubscriptionRecord,
  SubscriptionStatus,
} from "../internal/records.js";
import type { WebhookSendResult } from "../types.js";
import {
  breakerOpenUntil,
  isConnectionClass,
  recordBreaker,
} from "./breaker.js";
import { releaseJob } from "./claim.js";
import { writeDeadLetter } from "./deadletters.js";
import { markGapPending, queueGap, settleGapAfterAck } from "./gap.js";
import {
  callbackHost,
  InstanceInflight,
  settleJob,
  type EngineContext,
  type StoredJob,
} from "./jobs.js";
import { nextAttempt, parseRetryAfter, pause } from "./schedule.js";
import {
  readStatus,
  recordAttemptOutcome,
  updateStatus,
} from "./suspension.js";
import { takeThrottleSlot } from "./throttle.js";

/** What happened to one claimed job. */
export type AttemptOutcome =
  | "acked"
  | "retry"
  | "dropped"
  | "dead"
  | "parked"
  | "deferred"
  | "busy";

/** Append one attempt record (no bodies; admin only). */
export async function appendAttempt(
  ctx: EngineContext,
  subscriptionId: string,
  record: AttemptRecord
): Promise<void> {
  await ctx.storage.logAppend(
    ctx.keys.attempts(subscriptionId),
    JSON.stringify(record),
    { maxEvents: ctx.config.attemptLogMax }
  );
}

/** Read the attempt log of a subscription, oldest first. */
export async function readAttempts(
  ctx: EngineContext,
  subscriptionId: string
): Promise<AttemptRecord[]> {
  const r = await ctx.storage.logRange(ctx.keys.attempts(subscriptionId), {
    after: null,
    limit: ctx.config.attemptLogMax,
  });
  return r.entries.map((e) => JSON.parse(e.value) as AttemptRecord);
}

/** Classification of one send result. */
export interface Classified {
  ok: boolean;
  /** Non-retryable for this delivery. */
  terminal?: "http_410" | "http_413";
  error?: DeliveryErrorCategory;
  retryAfterMs?: number | undefined;
  status?: number | undefined;
  logOutcome:
    | "2xx"
    | "4xx"
    | "5xx"
    | "410"
    | "413"
    | "timeout"
    | "connection_refused"
    | "tls_error";
}

/** Classify a sender result (redirects count as `connection_refused`). */
export function classify(r: WebhookSendResult, now: number): Classified {
  if (!r.ok) {
    const e = r.error;
    const logOutcome =
      e === "timeout" || e === "tls_error" || e === "connection_refused"
        ? e
        : e === "http_5xx"
          ? "5xx"
          : "4xx";
    return { ok: false, error: e, logOutcome };
  }
  const s = r.status;
  if (s >= 200 && s < 300) return { ok: true, status: s, logOutcome: "2xx" };
  if (s === 410)
    return {
      ok: false,
      terminal: "http_410",
      error: "http_4xx",
      status: s,
      logOutcome: "410",
    };
  if (s === 413)
    return {
      ok: false,
      terminal: "http_413",
      error: "http_4xx",
      status: s,
      logOutcome: "413",
    };
  if (s >= 300 && s < 400)
    return {
      ok: false,
      error: "connection_refused",
      status: s,
      logOutcome: "connection_refused",
    };
  const retryAfterMs =
    s === 429 || s === 503
      ? parseRetryAfter(
          r.headers["retry-after"] ?? r.headers["Retry-After"],
          now
        )
      : undefined;
  return s >= 500
    ? {
        ok: false,
        error: "http_5xx",
        status: s,
        retryAfterMs,
        logOutcome: "5xx",
      }
    : {
        ok: false,
        error: "http_4xx",
        status: s,
        retryAfterMs,
        logOutcome: "4xx",
      };
}

/** Read a subscription record (undefined when missing). */
export async function readSubscription(
  ctx: EngineContext,
  subscriptionId: string
): Promise<SubscriptionRecord | undefined> {
  const got = await ctx.storage.read(ctx.keys.sub(subscriptionId));
  return got ? ctx.codec.decode<SubscriptionRecord>(got.value) : undefined;
}

interface Target {
  url: string;
  secrets: Uint8Array[];
}

function targetOf(
  sub: SubscriptionRecord | undefined,
  job: DeliverJob | ControlJob,
  now: number
): Target | null {
  if (job.kind === "control" && job.target) {
    const list = [job.target.secret, job.target.previousSecret]
      .filter((s): s is string => !!s)
      .map(parseWebhookSecret)
      .filter((b): b is Uint8Array => !!b);
    return { url: job.target.url, secrets: list };
  }
  if (!sub) return null;
  const list = [parseWebhookSecret(sub.secret)];
  if (sub.previousSecret && sub.previousSecret.expiresAt > now)
    list.push(parseWebhookSecret(sub.previousSecret.secret));
  return {
    url: sub.url,
    secrets: list.filter((b): b is Uint8Array => !!b),
  };
}

/**
 * Process one claimed `deliver` or `control` job.
 */
export async function attemptJob(
  ctx: EngineContext,
  stored: StoredJob<DeliverJob | ControlJob>
): Promise<AttemptOutcome> {
  const job = stored.job;
  const now = ctx.clock.now();
  const subId = job.subscriptionId;
  // Redeliveries were never in inflight; settling them must not touch it.
  const inflightSub = job.kind === "deliver" && job.redelivery ? null : subId;
  const terminatedJob = job.kind === "control" && job.type === "terminated";

  // 2. Stale: dead-letter without an attempt.
  if (now >= job.maxAgeAt) {
    await settleJob(ctx, job.id, inflightSub);
    await writeDeadLetter(ctx, job, "stale");
    ctx.log({ type: "stale", subscription: subId, reason: "max_age" });
    const sub = await readSubscription(ctx, subId);
    if (sub && job.kind === "deliver") {
      await markGapPending(ctx, sub);
      await recordAbandon(ctx, subId);
    }
    return "dead";
  }

  // 3–4. Subscription checks.
  const sub = await readSubscription(ctx, subId);
  const tomb = await ctx.storage.read(ctx.keys.tomb(subId));
  const gone =
    !sub ||
    tomb !== undefined ||
    (sub.expiresAt !== null && sub.expiresAt <= now);
  if (gone && !terminatedJob) {
    await settleJob(ctx, job.id, inflightSub);
    return "dropped";
  }
  const { status } = await readStatus(ctx, subId);

  if (job.kind === "deliver" && sub) {
    // 5. Start pending → reschedule by 1 s.
    if (sub.start === null) {
      await releaseJob(ctx, stored, now + 1000);
      return "deferred";
    }
    // 6. At or before start → drop.
    if (job.epoch === sub.start.epoch && job.seq <= sub.start.seq) {
      await settleJob(ctx, job.id, inflightSub);
      return "dropped";
    }
  }

  // 7. Suspended → park (out of due, stays in inflight, lease released).
  if (!terminatedJob && !status.active) {
    await releaseJob(ctx, stored, null);
    return "parked";
  }

  const target = targetOf(sub, job, now);
  if (!target) {
    await settleJob(ctx, job.id, inflightSub);
    return "dropped";
  }
  const host = callbackHost(target.url);

  // 8. Breaker open → reschedule at close time, window paused.
  const openUntil = await breakerOpenUntil(ctx, host);
  if (openUntil !== null) {
    pause(job, openUntil - now);
    await releaseJob(ctx, stored, openUntil);
    return "deferred";
  }

  // 9. Loop guard (event deliveries only).
  if (job.kind === "deliver") {
    const t = await takeThrottleSlot(ctx, subId);
    if (!t.ok) {
      const windowEnd =
        (job.firstAttemptAt ?? job.createdAt) +
        ctx.config.retryWindowMs +
        job.pausedMs;
      if (t.retryAt > windowEnd) {
        await settleJob(ctx, job.id, inflightSub);
        ctx.log({
          type: "loop_suspected",
          subscription: subId,
          ...(sub ? { name: sub.name } : {}),
          reason: "throttled",
        });
        if (sub) await markGapPending(ctx, sub);
        return "dropped";
      }
      await releaseJob(ctx, stored, t.retryAt);
      return "deferred";
    }
  }

  // 10. Per-instance concurrency.
  const slots = (ctx.inflight ??= new InstanceInflight());
  const hostLimit =
    ctx.config.hostConcurrency[host] ?? ctx.config.perHostConcurrency;
  if (!slots.take(`h:${host}`, hostLimit)) {
    await releaseJob(ctx, stored, now + 1000);
    return "busy";
  }
  if (!slots.take(`s:${subId}`, ctx.config.perSubscriptionConcurrency)) {
    slots.release(`h:${host}`);
    await releaseJob(ctx, stored, now + 1000);
    return "busy";
  }

  // 11. Sign with a fresh timestamp and POST.
  let result: WebhookSendResult;
  try {
    const ts = Math.floor(ctx.clock.now() / 1000);
    const bytes = new TextEncoder().encode(job.body);
    const signature = await signWebhook(
      target.secrets,
      job.webhookId,
      ts,
      bytes
    );
    result = await ctx.send({
      url: target.url,
      headers: {
        "content-type": "application/json",
        [WEBHOOK_HEADERS.id]: job.webhookId,
        [WEBHOOK_HEADERS.timestamp]: String(ts),
        [WEBHOOK_HEADERS.signature]: signature,
        "x-mcp-subscription-id": subId,
      },
      body: job.body,
      timeoutMs: ctx.config.deliveryTimeoutMs,
      connectTimeoutMs: ctx.config.connectTimeoutMs,
    });
  } catch {
    result = { ok: false, error: "connection_refused", ms: 0 };
  } finally {
    slots.release(`h:${host}`);
    slots.release(`s:${subId}`);
  }

  // 12. Classify and settle.
  const after = ctx.clock.now();
  const c = classify(result, after);
  job.attempt += 1;
  job.firstAttemptAt ??= now;
  job.lastAttemptAt = after;
  await recordBreaker(
    ctx,
    host,
    c.ok,
    !c.ok && !c.terminal && c.status === undefined
      ? isConnectionClass(c.error!)
      : false
  );
  const attemptKind: AttemptRecord["kind"] =
    job.kind === "deliver" ? "event" : job.type;
  const base = {
    at: after,
    kind: attemptKind,
    ...(job.kind === "deliver" ? { eventId: job.eventId } : {}),
    webhookId: job.webhookId,
    attempt: job.attempt,
    ...(c.status !== undefined ? { httpStatus: c.status } : {}),
    ms: result.ms,
  };
  const name = sub?.name ?? "";
  const noExpiry = sub ? sub.expiresAt === null : false;

  if (c.ok) {
    await settleJob(ctx, job.id, inflightSub);
    await appendAttempt(ctx, subId, { ...base, outcome: "ack" });
    ctx.log(deliverLog(name, subId, job, c, result.ms));
    if (sub && !terminatedJob) {
      await recordAttemptOutcome(ctx, subId, { ok: true }, noExpiry);
      await settleGapAfterAck(
        ctx,
        sub,
        (await readStatus(ctx, subId)).status.gapPending
      );
    }
    return "acked";
  }

  if (c.terminal) {
    await settleJob(ctx, job.id, inflightSub);
    await writeDeadLetter(ctx, job, c.terminal);
    await appendAttempt(ctx, subId, {
      ...base,
      outcome: c.terminal === "http_410" ? "gone" : "too_large",
    });
    ctx.log(deliverLog(name, subId, job, c, result.ms));
    if (sub && !terminatedJob) {
      await recordAttemptOutcome(
        ctx,
        subId,
        { ok: false, error: "http_4xx" },
        noExpiry
      );
      await recordAbandon(ctx, subId);
      // 413 on a replayable sep subscription sends a gap at once; 410 never.
      if (c.terminal === "http_413" && job.kind === "deliver")
        await queueGap(ctx, sub);
    }
    return "dead";
  }

  const next = nextAttempt(job, ctx.config, after, c.retryAfterMs);
  if ("exhausted" in next) {
    await settleJob(ctx, job.id, inflightSub);
    await writeDeadLetter(ctx, job, "exhausted");
    await appendAttempt(ctx, subId, { ...base, outcome: c.error! });
    ctx.log(deliverLog(name, subId, job, c, result.ms));
    if (sub && !terminatedJob) {
      await recordAttemptOutcome(
        ctx,
        subId,
        { ok: false, error: c.error! },
        noExpiry
      );
      await recordAbandon(ctx, subId);
      if (job.kind === "deliver") await markGapPending(ctx, sub);
    }
    return "dead";
  }
  await appendAttempt(ctx, subId, {
    ...base,
    outcome: c.error!,
    nextAt: next.at,
  });
  ctx.log({
    ...deliverLog(name, subId, job, c, result.ms),
    nextRetryMs: next.at - after,
  });
  if (sub && !terminatedJob)
    await recordAttemptOutcome(
      ctx,
      subId,
      { ok: false, error: c.error! },
      noExpiry
    );
  await releaseJob(ctx, stored, next.at);
  return "retry";
}

function deliverLog(
  name: string,
  subscription: string,
  job: DeliverJob | ControlJob,
  c: Classified,
  ms: number
) {
  return {
    type: "deliver" as const,
    name,
    subscription,
    kind: job.kind === "deliver" ? ("event" as const) : job.type,
    attempt: job.attempt,
    ...(job.kind === "deliver" && job.redelivery
      ? { redelivery: true as const }
      : {}),
    outcome: c.logOutcome,
    ms,
  };
}

async function recordAbandon(ctx: EngineContext, subId: string): Promise<void> {
  await updateStatus(ctx, subId, (s: SubscriptionStatus) => {
    s.abandoned += 1;
  });
}
