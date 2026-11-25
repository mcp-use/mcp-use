/**
 * Anonymous webhook quotas (PLAN.md D13b): at most
 * `limits.anonymousSubscriptionsPerUrl` (20) per callback URL and
 * `limits.anonymousSubscriptionsPerNamespace` (10,000) per namespace,
 * counted in `ev:{ns}:anon:{h(url)}` and `ev:{ns}:anon:count`.
 *
 * @internal
 */

import { EventsError } from "@mcp-use/events-core";
import type { McpUseStorage } from "../../storage/types.js";
import { EVENTS_DEFAULTS } from "../config.js";
import type { EventsKeys } from "../store/keys.js";

/** Counter lifetime; the sweeper re-derives counts long before it ends. */
const COUNTER_TTL_MS = 30 * 24 * 60 * 60_000;

/** Quota limits. */
export interface AnonymousLimits {
  perUrl: number;
  perNamespace: number;
}

/** The default limits. */
export const DEFAULT_ANONYMOUS_LIMITS: AnonymousLimits = {
  perUrl: EVENTS_DEFAULTS.anonymousSubscriptionsPerUrl,
  perNamespace: EVENTS_DEFAULTS.anonymousSubscriptionsPerNamespace,
};

/**
 * Reserves one anonymous slot for a new subscription. Increments both
 * counters and rolls back when either is over its limit.
 *
 * @param storage - The store.
 * @param keys - Key codec.
 * @param url - The callback URL (hashed in the key).
 * @param limits - Quotas.
 * @throws {@link EventsError} `resourceExhausted` `{reason:"anonymous_quota", limit}`.
 */
export async function reserveAnonymousSlot(
  storage: McpUseStorage,
  keys: EventsKeys,
  url: string,
  limits: AnonymousLimits = DEFAULT_ANONYMOUS_LIMITS
): Promise<void> {
  const urlKey = await keys.anonUrl(url);
  const perUrl = await storage.incr(urlKey, { ttlMs: COUNTER_TTL_MS });
  if (perUrl > limits.perUrl) {
    await storage.incr(urlKey, { ttlMs: COUNTER_TTL_MS, by: -1 });
    throw new EventsError("resourceExhausted", "Anonymous quota reached", {
      reason: "anonymous_quota",
      limit: "anonymousSubscriptionsPerUrl",
    });
  }
  const total = await storage.incr(keys.anonCount(), { ttlMs: COUNTER_TTL_MS });
  if (total > limits.perNamespace) {
    await storage.incr(keys.anonCount(), { ttlMs: COUNTER_TTL_MS, by: -1 });
    await storage.incr(urlKey, { ttlMs: COUNTER_TTL_MS, by: -1 });
    throw new EventsError("resourceExhausted", "Anonymous quota reached", {
      reason: "anonymous_quota",
      limit: "anonymousSubscriptionsPerNamespace",
    });
  }
}

/**
 * Releases a slot when an anonymous subscription is removed or its create fails.
 *
 * @param storage - The store.
 * @param keys - Key codec.
 * @param url - The callback URL.
 */
export async function releaseAnonymousSlot(
  storage: McpUseStorage,
  keys: EventsKeys,
  url: string
): Promise<void> {
  await storage.incr(await keys.anonUrl(url), {
    ttlMs: COUNTER_TTL_MS,
    by: -1,
  });
  await storage.incr(keys.anonCount(), { ttlMs: COUNTER_TTL_MS, by: -1 });
}
