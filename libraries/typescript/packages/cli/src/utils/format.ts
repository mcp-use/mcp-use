import chalk from "chalk";
import type { CallToolResult } from "mcp-use/client";

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const GUTTER = "  ";
const MIN_TRUNCATABLE_WIDTH = 8;
const DEFAULT_MAX_WIDTH = 100;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

function padCell(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w >= width) return s;
  return s + " ".repeat(width - w);
}

function truncateCell(s: string, width: number): string {
  if (width <= 0) return "";
  const plain = stripAnsi(s);
  if (plain.length <= width) return s;
  if (width === 1) return "…";
  return plain.slice(0, width - 1) + "…";
}

export interface TableColumn {
  key: string;
  header: string;
  width?: number;
  truncate?: boolean;
}

export interface FormatTableOptions {
  /**
   * Force TSV output regardless of TTY detection. When undefined, auto-detects:
   * non-TTY stdout (pipes, agents, CI) gets TSV; TTY gets the borderless table.
   */
  tsv?: boolean;
  /**
   * Maximum total line width for the table. Defaults to the terminal width
   * (process.stdout.columns) or 100 when unavailable.
   */
  maxWidth?: number;
}

/**
 * Render rows as either a borderless aligned-columns table (TTY, gh-style)
 * or tab-separated values (non-TTY, machine-readable). Width math strips
 * ANSI escape sequences so colored cells align correctly.
 */
export function formatTable(
  data: Array<Record<string, any>>,
  columns: TableColumn[],
  options: FormatTableOptions = {}
): string {
  const tsv = options.tsv ?? !process.stdout.isTTY;

  if (tsv) {
    return data
      .map((row) =>
        columns
          .map((c) =>
            stripAnsi(String(row[c.key] ?? "")).replace(/[\t\r\n]+/g, " ")
          )
          .join("\t")
      )
      .join("\n");
  }

  if (data.length === 0) {
    return chalk.gray("No items found");
  }

  const maxWidth =
    options.maxWidth ?? process.stdout.columns ?? DEFAULT_MAX_WIDTH;

  // Natural width = max(header width, widest cell), per column.
  const natural = columns.map((col) => {
    const headerW = col.header.length;
    const dataW = data.reduce((m, row) => {
      return Math.max(m, visibleWidth(String(row[col.key] ?? "")));
    }, 0);
    return Math.max(headerW, dataW);
  });

  const widths = columns.map((c, i) => c.width ?? natural[i]);
  const overhead = GUTTER.length * (columns.length - 1);
  const totalWidth = () => widths.reduce((s, w) => s + w, 0) + overhead;

  // If the natural layout overflows, squeeze truncatable columns proportionally
  // to their natural size. Non-truncatable columns keep their full width.
  if (totalWidth() > maxWidth) {
    const truncIdxs = columns
      .map((c, i) => (c.truncate ? i : -1))
      .filter((i) => i >= 0);
    if (truncIdxs.length > 0) {
      const fixedSum = columns.reduce(
        (s, c, i) => s + (c.truncate ? 0 : widths[i]),
        0
      );
      const remaining = Math.max(
        truncIdxs.length * MIN_TRUNCATABLE_WIDTH,
        maxWidth - fixedSum - overhead
      );
      const truncSum = truncIdxs.reduce((s, i) => s + widths[i], 0) || 1;
      let used = 0;
      truncIdxs.forEach((i, idx) => {
        if (idx === truncIdxs.length - 1) {
          widths[i] = Math.max(MIN_TRUNCATABLE_WIDTH, remaining - used);
        } else {
          const share = Math.max(
            MIN_TRUNCATABLE_WIDTH,
            Math.floor((widths[i] / truncSum) * remaining)
          );
          widths[i] = share;
          used += share;
        }
      });
    }
  }

  const lines: string[] = [];

  // Header: UPPERCASE, bold. Pad all but the last cell.
  const headerCells = columns.map((c, i) => {
    const text = c.header.toUpperCase();
    const cell = i === columns.length - 1 ? text : padCell(text, widths[i]);
    return chalk.bold(cell);
  });
  lines.push(headerCells.join(GUTTER).trimEnd());

  for (const row of data) {
    const cells = columns.map((c, i) => {
      let v = String(row[c.key] ?? "");
      if (visibleWidth(v) > widths[i]) {
        v = truncateCell(v, widths[i]);
      }
      return i === columns.length - 1 ? v : padCell(v, widths[i]);
    });
    lines.push(cells.join(GUTTER).trimEnd());
  }

  return lines.join("\n");
}

/**
 * Whether stdout is piped/redirected. Callers use this to suppress decorative
 * headers ("Available Tools (N):") in non-TTY mode so output stays parseable.
 */
export function isStdoutTty(): boolean {
  return Boolean(process.stdout.isTTY);
}

/**
 * One-word tool mode badge derived from MCP tool annotations.
 * `readOnlyHint` wins; explicit `destructiveHint` is shown red; everything
 * else is "write" (yellow), the safer-than-destructive default for the many
 * tools that simply don't annotate.
 */
export function formatToolMode(annotations?: {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}): string {
  if (annotations?.readOnlyHint === true) return chalk.green("read-only");
  if (annotations?.destructiveHint === true) return chalk.red("destructive");
  return chalk.yellow("write");
}

/**
 * Format data as JSON
 */
export function formatJson(data: any, pretty = true): string {
  if (pretty) {
    return JSON.stringify(data, null, 2);
  }
  return JSON.stringify(data);
}

/**
 * Format a tool call result
 */
export function formatToolCall(result: CallToolResult): string {
  const lines: string[] = [];
  const { isError, structuredContent } = result;
  const hasStructured =
    structuredContent !== undefined && structuredContent !== null;
  // Per MCP spec, when a tool returns structuredContent it SHOULD also
  // serialize the same JSON into a TextContent block for backwards
  // compatibility. Treat structuredContent as canonical and drop the text
  // duplicate. Non-text blocks (image/resource markers) are kept — they carry
  // information the structured payload doesn't, even though the terminal can
  // only render them as placeholders.
  const visibleContent = (result.content ?? []).filter(
    (item) => !hasStructured || item.type !== "text"
  );
  const hasVisibleContent = visibleContent.length > 0;

  if (isError) {
    lines.push(chalk.red("✗ Tool execution failed"));
    lines.push("");
  } else {
    lines.push(chalk.green("✓ Tool executed successfully"));
    lines.push("");
  }

  if (hasVisibleContent) {
    if (isError) {
      lines.push(chalk.red.bold("Error details:"));
    }
    visibleContent.forEach((item, index) => {
      if (visibleContent.length > 1) {
        lines.push(chalk.bold(`Content ${index + 1}:`));
      }

      if (item.type === "text") {
        lines.push(isError ? chalk.red(item.text) : item.text);
      } else if (item.type === "image") {
        lines.push(chalk.cyan(`[Image: ${item.mimeType || "unknown type"}]`));
        if (item.data) {
          lines.push(chalk.gray(`Data: ${item.data.substring(0, 50)}...`));
        }
      } else if (item.type === "resource") {
        lines.push(chalk.cyan(`[Resource]`));
        if (item.resource?.uri) {
          lines.push(chalk.gray(`URI: ${item.resource.uri}`));
        }
        if (item.resource && "text" in item.resource && item.resource.text) {
          lines.push(item.resource.text);
        }
      } else {
        lines.push(chalk.gray(`[Unknown content type: ${item.type}]`));
      }

      if (index < visibleContent.length - 1) {
        lines.push("");
      }
    });
  }

  if (hasStructured) {
    if (isError) {
      lines.push(chalk.bold("Structured error data:"));
    }
    lines.push(formatJson(structuredContent));
  }

  if (isError && !hasVisibleContent && !hasStructured) {
    lines.push(chalk.gray("(no error details provided by server)"));
  }

  return lines.join("\n");
}

/**
 * Format resource content
 */
export function formatResourceContent(content: any): string {
  if (!content || !content.contents) {
    return chalk.gray("No content");
  }

  const lines: string[] = [];

  content.contents.forEach((item: any, index: number) => {
    if (content.contents.length > 1) {
      lines.push(chalk.bold(`Content ${index + 1}:`));
    }

    if (item.uri) {
      lines.push(chalk.gray(`URI: ${item.uri}`));
    }

    if (item.mimeType) {
      lines.push(chalk.gray(`Type: ${item.mimeType}`));
    }

    if ("text" in item && item.text) {
      lines.push("");
      lines.push(item.text);
    } else if ("blob" in item && item.blob) {
      lines.push("");
      lines.push(chalk.cyan(`[Binary data: ${item.blob.length} bytes]`));
    }

    if (index < content.contents.length - 1) {
      lines.push("");
      lines.push(chalk.gray("─".repeat(50)));
      lines.push("");
    }
  });

  return lines.join("\n");
}

/**
 * Format a JSON schema in a readable way
 */
export function formatSchema(schema: any, indent = 0): string {
  if (!schema) {
    return chalk.gray("No schema");
  }

  const lines: string[] = [];
  const pad = "  ".repeat(indent);

  if (schema.type === "object" && schema.properties) {
    Object.entries(schema.properties).forEach(([key, value]: [string, any]) => {
      const required = schema.required?.includes(key);
      const type = value.type || "any";
      const desc = value.description || "";

      const keyStr = required ? chalk.bold(key) : key;
      const typeStr = chalk.cyan(`(${type})`);
      const requiredStr = required ? chalk.red(" *required") : "";

      lines.push(`${pad}${keyStr} ${typeStr}${requiredStr}`);

      if (desc) {
        lines.push(`${pad}  ${chalk.gray(desc)}`);
      }

      // Handle nested objects
      if (value.type === "object" && value.properties) {
        lines.push(formatSchema(value, indent + 1));
      }

      // Handle arrays
      if (value.type === "array" && value.items) {
        lines.push(`${pad}  ${chalk.gray("Items:")}`);
        if (value.items.type === "object") {
          lines.push(formatSchema(value.items, indent + 2));
        } else {
          lines.push(
            `${pad}    ${chalk.cyan(`(${value.items.type || "any"})`)}`
          );
        }
      }
    });
  } else {
    lines.push(`${pad}${chalk.cyan(`Type: ${schema.type || "any"}`)}`);
    if (schema.description) {
      lines.push(`${pad}${chalk.gray(schema.description)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a list of items with bullets
 */
export function formatList(items: string[], bullet = "•"): string {
  return items.map((item) => `  ${bullet} ${item}`).join("\n");
}

/**
 * Format an error message
 */
export function formatError(error: Error | string): string {
  const message = typeof error === "string" ? error : error.message;
  return chalk.red(`✗ Error: ${message}`);
}

/**
 * Format a success message
 */
export function formatSuccess(message: string): string {
  return chalk.green(`✓ ${message}`);
}

/**
 * Format an info message
 */
export function formatInfo(message: string): string {
  return chalk.cyan(message);
}

/**
 * Format a warning message
 */
export function formatWarning(message: string): string {
  return chalk.yellow(`⚠ ${message}`);
}

/**
 * Create a section header
 */
export function formatHeader(text: string): string {
  return chalk.bold.white(text);
}

/**
 * Format key-value pairs
 */
export function formatKeyValue(
  pairs: Record<string, string | number | boolean>
): string {
  const maxKeyLength = Math.max(...Object.keys(pairs).map((k) => k.length), 0);

  return Object.entries(pairs)
    .map(([key, value]) => {
      const paddedKey = key.padEnd(maxKeyLength);
      return `  ${chalk.gray(paddedKey)}: ${value}`;
    })
    .join("\n");
}

/**
 * Format prompt messages
 */
/**
 * Format a date string as relative time (e.g., "2 hours ago", "3 days ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) {
    return `${diffYears} year${diffYears > 1 ? "s" : ""} ago`;
  } else if (diffMonths > 0) {
    return `${diffMonths} month${diffMonths > 1 ? "s" : ""} ago`;
  } else if (diffWeeks > 0) {
    return `${diffWeeks} week${diffWeeks > 1 ? "s" : ""} ago`;
  } else if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  } else if (diffMins > 0) {
    return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  } else {
    return "just now";
  }
}

export function formatPromptMessages(messages: any[]): string {
  if (!messages || messages.length === 0) {
    return chalk.gray("No messages");
  }

  const lines: string[] = [];

  messages.forEach((msg, index) => {
    const role = msg.role || "unknown";
    const roleStr =
      role === "user"
        ? chalk.blue("[User]")
        : role === "assistant"
          ? chalk.green("[Assistant]")
          : chalk.gray(`[${role}]`);

    lines.push(`${roleStr}`);

    if (msg.content) {
      if (typeof msg.content === "string") {
        lines.push(msg.content);
      } else if (msg.content.type === "text") {
        lines.push(msg.content.text);
      } else if (msg.content.type === "image") {
        lines.push(chalk.cyan(`[Image: ${msg.content.mimeType}]`));
      } else if (msg.content.type === "resource") {
        lines.push(chalk.cyan(`[Resource: ${msg.content.resource?.uri}]`));
        if (msg.content.resource?.text) {
          lines.push(msg.content.resource.text);
        }
      }
    }

    if (index < messages.length - 1) {
      lines.push("");
    }
  });

  return lines.join("\n");
}
