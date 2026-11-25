/**
 * Human and JSON lines of `mcp-use client <server> events …`.
 *
 * Long-running commands (`listen`, `poll --follow`, `stream`) print one line
 * per delivery or frame; with `--json` each line is one JSON object (NDJSON).
 *
 * @internal
 */

import type {
  ConformanceReport,
  EventDescriptor,
  EventEnvelope,
} from "./types.js";

/** Write one line to stdout. */
export function line(text: string): void {
  process.stdout.write(`${text}\n`);
}

/** Write one NDJSON record to stdout. */
export function record(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/**
 * `events list` human output: `name [modes] - description`.
 *
 * @param events - Listed descriptors.
 * @returns The text.
 */
export function formatEventList(events: readonly EventDescriptor[]): string {
  if (events.length === 0) return "No events.";
  return events
    .map((e) => {
      const head = `${e.name} [${e.delivery.join(",")}]`;
      return e.description ? `${head} - ${e.description}` : head;
    })
    .join("\n");
}

/**
 * One delivered event as a human line.
 *
 * @param at - Arrival time, ISO 8601.
 * @param event - The event.
 * @param extra - Extra columns (`webhook-id`, checks).
 * @returns The line.
 */
export function formatEventLine(
  at: string,
  event: EventEnvelope,
  extra: readonly string[] = []
): string {
  return [
    at,
    event.eventId,
    ...extra,
    `cursor=${event.cursor ?? "-"}`,
    JSON.stringify(event.data),
  ].join(" ");
}

/**
 * A conformance report as text: one row per check and profile, then totals.
 *
 * @param report - The report.
 * @returns The text.
 */
export function formatConformanceText(report: ConformanceReport): string {
  const rows = report.results.map((r) => {
    const outcome = r.outcome.toUpperCase().padEnd(4);
    const detail = r.detail ? ` - ${r.detail}` : "";
    return `${outcome} ${r.dialect.padEnd(8)} ${r.level.padEnd(6)} ${r.id}${detail}`;
  });
  const s = report.summary;
  rows.push(
    "",
    `${s.passed} passed, ${s.mustFailed} MUST failed, ${s.shouldFailed} SHOULD failed, ${s.skipped} skipped`
  );
  return rows.join("\n");
}
