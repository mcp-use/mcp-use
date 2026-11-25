/**
 * Control entries (PLAN.md §8.8.5, D56): `{k:"t", to, error}` log values that
 * carry termination and revocation to poll and push readers positionally.
 *
 * @internal
 */

import type { EventsErrorKind } from "@mcp-use/events-core";
import type { LogTarget, LogValue } from "../internal/records.js";

/** A control log value. */
export type ControlValue = Extract<LogValue, { k: "t" }>;

/**
 * Builds a control entry.
 *
 * @param to - Who it targets (`all: true` for decommission).
 * @param error - The error readers answer with.
 * @param now - Append time.
 * @returns The log value.
 */
export function controlEntry(
  to: LogTarget & { all?: true },
  error: {
    kind: EventsErrorKind;
    message: string;
    data?: Record<string, unknown>;
  },
  now: number
): ControlValue {
  return { v: 1, k: "t", at: now, to: { ...to }, error: { ...error } };
}

/**
 * Whether a control entry applies to a reader.
 *
 * @param entry - The control value.
 * @param reader - The reader's principal and, for webhooks, subscription id.
 * @returns `true` when it targets everyone, the principal or the subscription.
 */
export function controlApplies(
  entry: ControlValue,
  reader: { principal: string; subscriptionId?: string }
): boolean {
  const to = entry.to;
  if (to.all) return true;
  if (to.principals?.includes(reader.principal)) return true;
  return (
    to.subscriptionId !== undefined &&
    to.subscriptionId === reader.subscriptionId
  );
}

/**
 * Whether an event entry is visible to a reader under its targeting.
 *
 * @param to - The entry's target, if any.
 * @param reader - The reader.
 * @returns `true` for untargeted entries or a matching target.
 */
export function targetIncludes(
  to: LogTarget | undefined,
  reader: { principal: string; subscriptionId?: string }
): boolean {
  if (!to || (to.principals === undefined && to.subscriptionId === undefined))
    return true;
  if (to.principals?.includes(reader.principal)) return true;
  return (
    to.subscriptionId !== undefined &&
    to.subscriptionId === reader.subscriptionId
  );
}
