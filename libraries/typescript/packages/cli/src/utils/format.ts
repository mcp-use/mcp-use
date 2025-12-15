import chalk from "chalk";
import type { CallToolResult } from "mcp-use/client";

/**
 * Format data as a table with ASCII borders
 */
export function formatTable(
  data: Array<Record<string, any>>,
  columns: Array<{ key: string; header: string; width?: number }>
): string {
  if (data.length === 0) {
    return chalk.gray("No items found");
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    const maxDataWidth = Math.max(
      ...data.map((row) => String(row[col.key] || "").length)
    );
    const headerWidth = col.header.length;
    return col.width || Math.max(maxDataWidth, headerWidth, 10);
  });

  // Helper to create a row
  const createRow = (values: string[], bold = false) => {
    const cells = values.map((val, i) => {
      const padded = val.padEnd(widths[i]);
      return bold ? chalk.bold(padded) : padded;
    });
    return `│ ${cells.join(" │ ")} │`;
  };

  // Create separator line
  const separator = (char: string) => {
    const parts = widths.map((w) => char.repeat(w + 2));
    if (char === "─") {
      return `├${parts.join("┼")}┤`;
    }
    return `└${parts.join("┴")}┘`;
  };

  // Build table
  const lines: string[] = [];

  // Top border
  lines.push(`┌${widths.map((w) => "─".repeat(w + 2)).join("┬")}┐`);

  // Header
  lines.push(
    createRow(
      columns.map((c) => c.header),
      true
    )
  );

  // Separator
  lines.push(separator("─"));

  // Data rows
  data.forEach((row) => {
    lines.push(createRow(columns.map((c) => String(row[c.key] || ""))));
  });

  // Bottom border
  lines.push(separator("─"));

  return lines.join("\n");
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

  if (result.isError) {
    lines.push(chalk.red("✗ Tool execution failed"));
    lines.push("");
  } else {
    lines.push(chalk.green("✓ Tool executed successfully"));
    lines.push("");
  }

  // Format content
  if (result.content && result.content.length > 0) {
    result.content.forEach((item, index) => {
      if (result.content.length > 1) {
        lines.push(chalk.bold(`Content ${index + 1}:`));
      }

      if (item.type === "text") {
        lines.push(item.text);
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

      if (index < result.content.length - 1) {
        lines.push("");
      }
    });
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
