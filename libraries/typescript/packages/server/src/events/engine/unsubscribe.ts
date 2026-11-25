/**
 * `events/unsubscribe` (PLAN.md §6.8). The backend removes the record and its
 * jobs and enqueues a `hook` job (reason `"unsubscribed"`) when the event has
 * `onUnsubscribe`. Hidden, dormant or removed events still unsubscribe.
 *
 * @internal
 */

import { EventsError, normalizeArguments } from "@mcp-use/events-core";
import type { ProfileAxes } from "@mcp-use/events-core";
import type { EventsBackend } from "../internal/backend.js";

/** Wire parameters of `events/unsubscribe`. */
export interface UnsubscribeParams {
  name?: unknown;
  arguments?: unknown;
  delivery?: unknown;
}

/**
 * Removes the subscription keyed by `(principal, url, name, args ?? {})`.
 *
 * @returns `{}`; under `unsubscribeMissing: "notFound"` a miss throws NotFound `{kind:"subscription"}`.
 */
export async function handleUnsubscribe(
  params: UnsubscribeParams,
  deps: {
    backend: EventsBackend;
    axes: Pick<ProfileAxes, "unsubscribeMissing">;
    principal(): string | null;
    now(): number;
  }
): Promise<Record<string, never>> {
  if (typeof params.name !== "string")
    throw new EventsError("invalidParams", "", { field: "name" });
  const d =
    params.delivery !== null && typeof params.delivery === "object"
      ? (params.delivery as Record<string, unknown>)
      : {};
  if (typeof d.url !== "string")
    throw new EventsError("invalidParams", "", { field: "delivery.url" });
  const principal = deps.principal();
  if (principal === null)
    throw new EventsError("forbidden", "", { reason: "principal_required" });
  const { removed } = await deps.backend.unsubscribe(
    {
      principal,
      url: d.url,
      name: params.name,
      args: normalizeArguments(params.arguments),
    },
    { now: deps.now() }
  );
  if (removed === null && deps.axes.unsubscribeMissing === "notFound")
    throw new EventsError("notFound", "", { kind: "subscription" });
  return {};
}
