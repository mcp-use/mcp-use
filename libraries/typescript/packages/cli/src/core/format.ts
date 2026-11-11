import { stripVTControlCharacters } from "node:util";

/** Untrusted Cloud text must not control the user's terminal. */
export function plain(value: unknown): string {
  return (
    stripVTControlCharacters(String(value ?? ""))
      // Remove controls while retaining newlines for readable messages.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
      .replaceAll("\t", "  ")
  );
}

/** Wrap prose without shortening commands, identifiers, or URLs. */
export function prose(
  value: unknown,
  indent = "",
  width = process.stdout.columns || 100
): string {
  const available = Math.max(20, width - indent.length);
  return plain(value)
    .split("\n")
    .map((paragraph) => {
      const lines: string[] = [];
      let line = "";
      for (const word of paragraph.trim().split(/\s+/)) {
        if (line && line.length + word.length + 1 > available) {
          lines.push(indent + line);
          line = "";
        }
        line += `${line ? " " : ""}${word}`;
      }
      lines.push(indent + line);
      return lines.join("\n");
    })
    .join("\n");
}

/** Aligned fields for detail pages and mutation receipts. */
export function fields(rows: Array<[string, unknown]>): string {
  const present = rows.filter(
    ([, value]) => value !== undefined && value !== null && value !== ""
  );
  const width = Math.max(0, ...present.map(([label]) => label.length)) + 2;
  return present
    .map(([label, value]) => `${label.padEnd(width)}${plain(value)}`)
    .join("\n");
}

/** Tables fall back to labeled records when a terminal is too narrow. */
export function table(
  headers: string[],
  rows: unknown[][],
  width = process.stdout.columns || 120
): string {
  const cells = rows.map((row) =>
    row.map((cell) => plain(cell).replaceAll("\n", " ") || "—")
  );
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...cells.map((row) => row[i]?.length ?? 0))
  );
  if (
    widths.reduce((sum, size) => sum + size, 0) + (headers.length - 1) * 2 >
    width
  ) {
    return cells
      .map((row) => fields(headers.map((header, i) => [header, row[i]])))
      .join("\n\n");
  }
  return [headers, ...cells]
    .map((row) =>
      row
        .map((cell, i) => cell.padEnd(widths[i] ?? 0))
        .join("  ")
        .trimEnd()
    )
    .join("\n");
}

/** Stable local date with timezone; invalid timestamps stay absent. */
export function date(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return undefined;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

/** Format a measured interval, never infer one from last-update timestamps. */
export function elapsed(start: unknown, end: unknown): string | undefined {
  if (typeof start !== "string" || typeof end !== "string") return undefined;
  const ms = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const seconds = Math.round(ms / 1000);
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
}

/** Compact age for list views; details retain the absolute timestamp. */
export function age(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return undefined;
  const seconds = Math.floor((Date.now() - Date.parse(value)) / 1000);
  if (seconds < 0) return date(value);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Safely inspect optional presentation metadata omitted from older API schemas. */
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
