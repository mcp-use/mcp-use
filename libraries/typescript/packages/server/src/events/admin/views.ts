/**
 * Keyed admin views (PLAN.md §12.3.3, D66): catalog, subscriptions with
 * attempts, direct leases and dead letters. Records are opened through an
 * {@link AdminCodec} (WP-12's sealing with the keyring).
 *
 * @internal
 */

import type { McpUseStorage } from "../../storage/types.js";
import { EventsConfigError } from "../errors.js";
import type {
  AttemptRecord,
  CatalogRecord,
  DeadLetter,
  DirectLease,
  SubscriptionRecord,
  SubscriptionStatus,
} from "../internal/records.js";
import type { SubscriptionView } from "../types.js";
import type { AdminKeys } from "./status.js";
import type { AdminSubscriptionQuery, DeadLetterView } from "./types.js";

/** Opens and seals stored values with the keyring (full key as AD). */
export interface AdminCodec {
  /** Decode a stored value; throws when no key opens it. */
  open(key: string, stored: string): Promise<unknown>;
  /** Encode a value with the first key. */
  seal(key: string, value: unknown): Promise<string>;
}

/** A codec for an unsealed (dev) store: plain JSON. */
export const plainCodec: AdminCodec = {
  async open(_key, stored) {
    return JSON.parse(stored) as unknown;
  },
  async seal(_key, value) {
    return JSON.stringify(value);
  },
};

/** A codec placeholder used when the binding has no keyring. */
export const keylessCodec: AdminCodec = {
  open() {
    return Promise.reject(
      new EventsConfigError(
        "EVENTS_SECRET_REQUIRED",
        "events admin: this operation needs the namespace keyring (EventsBinding.secret)."
      )
    );
  },
  seal() {
    return keylessCodec.open("", "") as Promise<string>;
  },
};

/** What the view functions need. */
export interface ViewContext {
  storage: McpUseStorage;
  keys: AdminKeys;
  codec: AdminCodec;
}

async function readRecord<T>(
  ctx: ViewContext,
  key: string
): Promise<T | undefined> {
  const v = await ctx.storage.read(key);
  if (v === undefined) return undefined;
  return (await ctx.codec.open(key, v.value)) as T;
}

const iso = (ms: number) => new Date(ms).toISOString();

function origin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Convert a stored webhook subscription to its admin view.
 *
 * @param r - Record.
 * @param s - Status record.
 */
export function webhookView(
  r: SubscriptionRecord,
  s: SubscriptionStatus | undefined
): SubscriptionView {
  const view: SubscriptionView = {
    id: r.id,
    name: r.name,
    args: r.args,
    principal: r.principal,
    mode: "webhook",
    profile: {
      preset: r.profile.preset,
      revision: r.profile.revision,
      via: r.profile.via,
    },
    era: r.meta.era,
    partition: r.partition,
    callbackOrigin: origin(r.url),
    createdAt: iso(r.createdAt),
    refreshedAt: iso(r.refreshedAt),
    expiresAt: r.expiresAt === null ? null : iso(r.expiresAt),
    status: s === undefined || s.active ? "active" : "suspended",
    // TODO(events): derive the watermark via WP-15 (`backend.watermark`).
    watermark: null,
  };
  if (s?.lastDeliveryAt != null) view.lastDeliveryAt = iso(s.lastDeliveryAt);
  if (s?.lastError != null) view.lastError = s.lastError;
  if (r.meta.clientName !== undefined) view.clientName = r.meta.clientName;
  return view;
}

/**
 * Convert a direct lease to its admin view.
 *
 * @param l - Lease.
 */
export function leaseView(l: DirectLease): SubscriptionView {
  return {
    id: l.id,
    name: l.name,
    args: l.args,
    principal: l.principal,
    mode: l.modes.includes("push") ? "push" : "poll",
    profile: { preset: "sep-3415", revision: 0, via: "lease" },
    era: "modern",
    partition: null,
    callbackOrigin: null,
    createdAt: iso(l.createdAt),
    refreshedAt: iso(l.touchedAt),
    expiresAt: iso(l.expiresAt),
    status: "active",
    watermark: null,
  };
}

async function page(
  ctx: ViewContext,
  index: string,
  after: string | undefined,
  limit: number
): Promise<{ ids: string[]; next?: string }> {
  const q: { limit: number; after?: string } = { limit };
  if (after !== undefined) q.after = after;
  const p = await ctx.storage.indexRange(index, q);
  const out: { ids: string[]; next?: string } = {
    ids: p.items.map((i) => i.member),
  };
  if (p.next !== undefined) out.next = p.next;
  return out;
}

const clampLimit = (n: number | undefined) =>
  Math.min(Math.max(1, n ?? 50), 500);

/** `catalog()`. */
export async function viewCatalog(
  ctx: ViewContext
): Promise<CatalogRecord | null> {
  return (await readRecord<CatalogRecord>(ctx, ctx.keys.catalog)) ?? null;
}

/** `subscriptions(q)`: filters apply within the page. */
export async function viewSubscriptions(
  ctx: ViewContext,
  q: AdminSubscriptionQuery = {}
): Promise<{ items: SubscriptionView[]; next?: string }> {
  if (q.mode !== undefined && q.mode !== "webhook") return { items: [] };
  const p = await page(ctx, ctx.keys.expiry, q.after, clampLimit(q.limit));
  const items: SubscriptionView[] = [];
  for (const id of p.ids) {
    const r = await readRecord<SubscriptionRecord>(ctx, ctx.keys.sub(id));
    if (r === undefined) continue;
    if (q.name !== undefined && r.name !== q.name) continue;
    if (q.principal !== undefined && r.principal !== q.principal) continue;
    const s = await readRecord<SubscriptionStatus>(ctx, ctx.keys.status(id));
    const v = webhookView(r, s);
    if (q.status !== undefined && v.status !== q.status) continue;
    items.push(v);
  }
  return p.next === undefined ? { items } : { items, next: p.next };
}

/** `subscription(id)` with its attempt log. */
export async function viewSubscription(
  ctx: ViewContext,
  id: string
): Promise<(SubscriptionView & { attempts: AttemptRecord[] }) | null> {
  const r = await readRecord<SubscriptionRecord>(ctx, ctx.keys.sub(id));
  if (r === undefined) return null;
  const s = await readRecord<SubscriptionStatus>(ctx, ctx.keys.status(id));
  const log = await ctx.storage.logRange(ctx.keys.attempts(id), {
    after: null,
    limit: 20,
  });
  const attempts: AttemptRecord[] = [];
  for (const e of log.entries)
    attempts.push(
      (await ctx.codec.open(ctx.keys.attempts(id), e.value)) as AttemptRecord
    );
  return { ...webhookView(r, s), attempts };
}

/** `leases(q)`. */
export async function viewLeases(
  ctx: ViewContext,
  q: { name?: string; principal?: string; after?: string; limit?: number } = {}
): Promise<{ items: SubscriptionView[]; next?: string }> {
  const p = await page(ctx, ctx.keys.leaseExpiry, q.after, clampLimit(q.limit));
  const items: SubscriptionView[] = [];
  for (const id of p.ids) {
    const l = await readRecord<DirectLease>(ctx, ctx.keys.lease(id));
    if (l === undefined) continue;
    if (q.name !== undefined && l.name !== q.name) continue;
    if (q.principal !== undefined && l.principal !== q.principal) continue;
    items.push(leaseView(l));
  }
  return p.next === undefined ? { items } : { items, next: p.next };
}

/**
 * Convert a dead letter to its view; the body is never returned.
 *
 * @param id - Dead-letter (job) id.
 * @param d - Stored dead letter.
 * @param callbackOrigin - Origin of the subscription URL, when known.
 */
export function deadLetterView(
  id: string,
  d: DeadLetter,
  callbackOrigin: string
): DeadLetterView {
  const job = d.job;
  const base = {
    id,
    reason: d.reason,
    abandonedAt: iso(d.at),
    callbackOrigin,
  };
  if (job.kind === "deliver")
    return {
      ...base,
      kind: "deliver",
      subscriptionId: job.subscriptionId,
      name: null,
      eventId: job.eventId,
      webhookId: job.webhookId,
      attempts: job.attempt,
      lastError: null,
      bodyBytes: job.bodyBytes,
    };
  if (job.kind === "control")
    return {
      ...base,
      kind: "control",
      type: job.type,
      subscriptionId: job.subscriptionId,
      name: null,
      eventId: null,
      webhookId: job.webhookId,
      attempts: job.attempt,
      lastError: null,
      bodyBytes: new TextEncoder().encode(job.body).length,
    };
  throw new Error(`dead letter ${id} holds a ${job.kind} job`);
}

/** `deadLetters(q)`. */
export async function viewDeadLetters(
  ctx: ViewContext,
  q: { subscriptionId?: string; after?: string; limit?: number } = {}
): Promise<{ items: DeadLetterView[]; next?: string }> {
  const p = await page(ctx, ctx.keys.dead, q.after, clampLimit(q.limit));
  const items: DeadLetterView[] = [];
  for (const id of p.ids) {
    const d = await readRecord<DeadLetter>(ctx, ctx.keys.deadLetter(id));
    if (
      d === undefined ||
      (d.job.kind !== "deliver" && d.job.kind !== "control")
    )
      continue;
    if (
      q.subscriptionId !== undefined &&
      d.job.subscriptionId !== q.subscriptionId
    )
      continue;
    const sub = await readRecord<SubscriptionRecord>(
      ctx,
      ctx.keys.sub(d.job.subscriptionId)
    );
    const target = d.job.kind === "control" ? d.job.target?.url : undefined;
    const o = origin(sub?.url ?? target ?? "") ?? "";
    const v = deadLetterView(id, d, o);
    if (sub !== undefined) v.name = sub.name;
    items.push(v);
  }
  return p.next === undefined ? { items } : { items, next: p.next };
}
