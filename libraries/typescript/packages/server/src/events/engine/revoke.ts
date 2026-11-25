/**
 * `revoke`: the single implementation behind `server.events.revoke` and the
 * admin library (PLAN.md §6.12). Webhook subscriptions are removed by the
 * backend (tombstone, `terminated` control job for `sep-3415`, hook jobs);
 * poll and push learn through log control entries (D56).
 *
 * @internal
 */

import { EventsError } from "@mcp-use/events-core";
import type { EventsBackend, RevokeFilterInternal } from "../internal/backend.js";
import type { EventsRegistry } from "../internal/registry.js";
import type { LogValue } from "../internal/records.js";
import type { SubscriptionView } from "../types.js";

/** Result of {@link revoke}. */
export interface RevokeResult {
  /** Webhook subscriptions removed. */
  removed: SubscriptionView[];
  /** Event logs that received a control entry for poll and push. */
  controlEntries: string[];
}

/**
 * Builds the control entry that ends matching poll and push subscriptions.
 *
 * @param target - The principal or direct id addressed.
 * @param error - The error polls answer and streams send as `terminated`.
 */
export function controlEntry(
  target: { principal?: string; subscriptionId?: string; all?: true },
  error: EventsError,
  at: number
): LogValue {
  const to: { principals?: string[]; subscriptionId?: string; all?: true } = {};
  if (target.principal !== undefined) to.principals = [target.principal];
  if (target.subscriptionId !== undefined) to.subscriptionId = target.subscriptionId;
  if (target.all === true) to.all = true;
  return {
    v: 1,
    k: "t",
    at,
    to,
    error: {
      kind: error.kind,
      message: error.message,
      ...(error.data !== undefined ? { data: error.data } : {}),
    },
  };
}

/**
 * Revokes subscriptions matching `filter`.
 *
 * @param error - Defaults to Forbidden `{reason:"revoked"}`.
 */
export async function revoke(
  filter: RevokeFilterInternal,
  deps: {
    backend: EventsBackend;
    registry: EventsRegistry;
    now(): number;
    error?: EventsError;
  }
): Promise<RevokeResult> {
  if (filter.principal === undefined && filter.subscriptionId === undefined)
    throw new TypeError("revoke needs a principal or a subscriptionId");
  const now = deps.now();
  const { removed } = await deps.backend.revoke(filter, { now });
  const error =
    deps.error ?? new EventsError("forbidden", "", { reason: "revoked" });
  const names =
    filter.name !== undefined
      ? [filter.name]
      : deps.registry.all().map((e) => e.name);
  const items = names.map((name) => ({
    name,
    value: controlEntry(
      {
        ...(filter.principal !== undefined ? { principal: filter.principal } : {}),
        ...(filter.subscriptionId !== undefined
          ? { subscriptionId: filter.subscriptionId }
          : {}),
      },
      error,
      now
    ),
    dedupeKey: null,
  }));
  if (items.length > 0) await deps.backend.append(items);
  return { removed, controlEntries: names };
}
