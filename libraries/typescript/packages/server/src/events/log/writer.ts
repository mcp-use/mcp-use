/**
 * Events log writer (PLAN.md §14): `text` (default) or `json` (one record
 * per stdout line with `schema: "mcp-use.events.log/1"`), plus the
 * `events.onLog` hook.
 *
 * @internal
 */

import { EVENTS_LOG_SCHEMA, type EventsLogRecord } from "../log-records.js";

/** Writer options. */
export interface LogWriterOptions {
  format: "text" | "json";
  onLog?: (record: EventsLogRecord) => void;
  /** Line sink; default `console.log`. */
  write?: (line: string) => void;
}

/** Format one record as a text line. */
export function formatTextRecord(record: EventsLogRecord): string {
  const parts = Object.entries(record)
    .filter(([k, v]) => k !== "type" && v !== undefined)
    .map(
      ([k, v]) =>
        `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`
    );
  return `events: ${record.type} ${parts.join(" ")}`.trimEnd();
}

/** Format one record as a JSON line. */
export function formatJsonRecord(record: EventsLogRecord): string {
  return JSON.stringify({ schema: EVENTS_LOG_SCHEMA, ...record });
}

/**
 * Create a log sink. `onLog` errors are swallowed.
 *
 * @param o - Format, hook and sink.
 */
export function createLogWriter(
  o: LogWriterOptions
): (record: EventsLogRecord) => void {
  const write = o.write ?? ((line: string) => console.log(line));
  return (record) => {
    try {
      o.onLog?.(record);
    } catch {
      // A failing hook never breaks the engine.
    }
    write(
      o.format === "json" ? formatJsonRecord(record) : formatTextRecord(record)
    );
  };
}
