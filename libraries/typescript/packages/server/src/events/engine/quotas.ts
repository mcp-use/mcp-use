/**
 * Create-time quotas (PLAN.md §6.7 step 7) and the per-instance sliding
 * rate limiter used for poll rates.
 *
 * @internal
 */

import { EventsError } from "@mcp-use/events-core";
import { EVENTS_DEFAULTS } from "../config.js";

/** Current subscription counts the quota check reads (create only). */
export interface QuotaCounts {
  /** Live subscriptions of the caller's principal. */
  byPrincipal(principal: string): Promise<number>;
  /** Live anonymous subscriptions to one callback URL. */
  anonymousByUrl(url: string): Promise<number>;
  /** Live anonymous subscriptions in the namespace. */
  anonymous(): Promise<number>;
  /** Every live subscription in the namespace. */
  all(): Promise<number>;
}

/** Quota limits; defaults from Appendix C. */
export interface QuotaLimits {
  subscriptionsPerPrincipal: number;
  anonymousSubscriptionsPerUrl: number;
  anonymousSubscriptionsPerNamespace: number;
  maxSubscriptions: number;
}

/** The Appendix C quota defaults. */
export const DEFAULT_QUOTAS: QuotaLimits = {
  subscriptionsPerPrincipal: EVENTS_DEFAULTS.subscriptionsPerPrincipal,
  anonymousSubscriptionsPerUrl: EVENTS_DEFAULTS.anonymousSubscriptionsPerUrl,
  anonymousSubscriptionsPerNamespace:
    EVENTS_DEFAULTS.anonymousSubscriptionsPerNamespace,
  maxSubscriptions: EVENTS_DEFAULTS.maxSubscriptions,
};

/** The principal every unauthenticated caller shares. */
export const ANONYMOUS_PRINCIPAL = "anonymous";

/**
 * Checks the create-only quotas in a fixed order: namespace total, anonymous
 * per namespace, anonymous per URL, per principal.
 *
 * @throws EventsError ResourceExhausted `{limit, max}` at the first exceeded quota.
 */
export async function checkCreateQuotas(
  q: { principal: string; url: string },
  counts: QuotaCounts,
  limits: QuotaLimits = DEFAULT_QUOTAS
): Promise<void> {
  const over = (limit: keyof QuotaLimits): never => {
    throw new EventsError("resourceExhausted", "", {
      limit,
      max: limits[limit],
    });
  };
  if ((await counts.all()) >= limits.maxSubscriptions)
    over("maxSubscriptions");
  if (q.principal === ANONYMOUS_PRINCIPAL) {
    if ((await counts.anonymous()) >= limits.anonymousSubscriptionsPerNamespace)
      over("anonymousSubscriptionsPerNamespace");
    if (
      (await counts.anonymousByUrl(q.url)) >= limits.anonymousSubscriptionsPerUrl
    )
      over("anonymousSubscriptionsPerUrl");
  }
  if (
    (await counts.byPrincipal(q.principal)) >= limits.subscriptionsPerPrincipal
  )
    over("subscriptionsPerPrincipal");
}

/** A per-instance sliding-window counter keyed by string. */
export interface RateLimiter {
  /**
   * Counts one hit for `key`.
   *
   * @returns `null` when allowed, else the ms until the window frees a slot.
   */
  hit(key: string, now: number): number | null;
}

/**
 * Creates a sliding-log rate limiter allowing `max` hits per `windowMs` per
 * key. Keys idle for a full window are dropped.
 */
export function createRateLimiter(max: number, windowMs = 60_000): RateLimiter {
  const hits = new Map<string, number[]>();
  let lastGc = 0;
  return {
    hit(key, now) {
      if (now - lastGc > windowMs) {
        lastGc = now;
        for (const [k, v] of hits)
          if (v.length === 0 || v[v.length - 1]! <= now - windowMs)
            hits.delete(k);
      }
      const list = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return Math.max(1, list[0]! + windowMs - now);
      }
      list.push(now);
      hits.set(key, list);
      return null;
    },
  };
}
