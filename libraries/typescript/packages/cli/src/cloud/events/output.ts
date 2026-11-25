/**
 * Human output for `mcp-use events …`. `--json` prints the response objects
 * unchanged (§11.4); these formatters only shape the terminal text.
 */
import { fields, plain, table } from "../../core/format.js";
import type {
  CloudAttemptRecord,
  CloudDeadLetterView,
  CloudEventsCatalog,
  CloudEventsStatus,
  CloudSubscriptionView,
  DeliveryRow,
} from "./contract.js";

type Status = Omit<
  CloudEventsStatus,
  "binding" | "namespaceHash" | "updatedAt"
> &
  Partial<Pick<CloudEventsStatus, "binding" | "namespaceHash" | "updatedAt">>;

/** Format `events status`. */
export function formatStatus(status: Status): string {
  if (status.binding === "user")
    return status.message ?? "Events state is in your own storage";
  return fields([
    ["Binding", status.binding],
    ["Namespace", status.namespaceHash],
    ["Layout", status.layout ?? "empty"],
    ["Closed", status.closed ? "yes" : "no"],
    ["Subscriptions", status.subscriptions],
    ["Leases", status.leases],
    ["Due", status.due],
    ["Fan-out due", status.fanoutDue],
    [
      "Oldest due",
      status.oldestDueAgeMs === null ? "-" : `${status.oldestDueAgeMs}ms`,
    ],
    ["Next wake", status.nextWakeAt ?? "-"],
    ["Dead letters", status.deadLetters],
  ]);
}

/** Format `events catalog` (Cloud shape, or a bare catalog record locally). */
export function formatCatalog(
  catalog: Pick<CloudEventsCatalog, "active"> & Partial<CloudEventsCatalog>
): string {
  const active = catalog.active;
  if (active === null) return "No active catalog.";
  const changes = new Map((catalog.diff ?? []).map((l) => [l.name, l.change]));
  const rows = Object.entries(active.events)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, entry]) => [
      plain(name),
      entry.replay ? "yes" : "no",
      changes.get(name) ?? "",
      catalog.missing?.[name] ?? "",
    ]);
  return `Catalog ${active.hash}\n${table(["Event", "Replay", "Change", "Missing since"], rows)}`;
}

/** Format a subscription page. */
export function formatSubscriptions(page: {
  items: CloudSubscriptionView[];
  next?: string;
}): string {
  if (page.items.length === 0) return "No subscriptions.";
  const rows = page.items.map((s) => [
    s.id,
    plain(s.name),
    s.mode,
    s.status,
    plain(s.principal),
    s.expiresAt ?? "-",
  ]);
  return `${table(["ID", "Event", "Mode", "Status", "Principal", "Expires"], rows)}${page.next ? `\nNext page: --after ${page.next}` : ""}`;
}

/** Format one subscription with its attempts. */
export function formatSubscription(
  s: CloudSubscriptionView & { attempts: CloudAttemptRecord[] }
): string {
  const head = fields([
    ["ID", s.id],
    ["Event", plain(s.name)],
    ["Args", JSON.stringify(s.args)],
    ["Principal", plain(s.principal)],
    ["Mode", s.mode],
    ["Status", s.status],
    ["Profile", `${s.profile.preset}@${s.profile.revision}`],
    ["Callback", s.callbackOrigin ?? "-"],
    ["Expires", s.expiresAt ?? "-"],
    ["Watermark", s.watermark ?? "-"],
    ["Last error", s.lastError],
  ]);
  if (s.attempts.length === 0) return `${head}\n\nNo attempts.`;
  return `${head}\n\n${table(
    ["At", "Kind", "Event", "Attempt", "Outcome", "HTTP", "ms"],
    s.attempts.map((a) => [
      new Date(a.at).toISOString(),
      a.kind,
      a.eventId ?? "",
      a.attempt,
      a.outcome,
      a.httpStatus ?? "",
      a.ms,
    ])
  )}`;
}

/** Format a deliveries page. */
export function formatDeliveries(page: {
  items: DeliveryRow[];
  next?: string;
}): string {
  if (page.items.length === 0) return "No deliveries.";
  return table(
    ["At", "Event", "Subscription", "Attempt", "Outcome", "ms", "Dead letter"],
    page.items.map((d) => [
      d.at,
      plain(d.name),
      d.subscription,
      d.attempt,
      d.outcome,
      d.ms,
      d.deadLetterId ?? "",
    ])
  );
}

/** Format a dead-letter page. */
export function formatDeadLetters(page: {
  items: CloudDeadLetterView[];
  next?: string;
}): string {
  if (page.items.length === 0) return "No dead letters.";
  return table(
    ["ID", "Subscription", "Event", "Reason", "Attempts", "Abandoned"],
    page.items.map((d) => [
      d.id,
      d.subscriptionId,
      d.name ?? "",
      d.reason,
      d.attempts,
      d.abandonedAt,
    ])
  );
}
