import { parseEnv } from "node:util";

import { UsageError } from "../core/errors.js";

const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ASSIGNMENT =
  /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*)$/;

/**
 * Parse dotenv text with Node's parser, the one behind `process.loadEnvFile`
 * that `mcp-use dev` and `mcp-use start` use for `.env`: quotes are removed,
 * inline comments are dropped, `\n` expands inside double quotes, and quoted
 * values may span lines. A leading UTF-8 BOM and tabs after `export` are
 * accepted. Assignments keep their file order. Values stay inside the process
 * and never appear in errors.
 */
export function parseEnvFile(source: string): { key: string; value: string }[] {
  const { text, order } = scanAssignments(source.replace(/^\uFEFF/, ""));
  return Object.entries(parseEnv(text))
    .map(([key, value]) => {
      if (!ENVIRONMENT_KEY.test(key))
        throw new UsageError(
          `Invalid environment variable name in file: ${key}`
        );
      return {
        key,
        value: value ?? "",
        position: order.get(key) ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.position - b.position)
    .map(({ key, value }) => ({ key, value }));
}

/**
 * Walk the assignment lines, skipping the continuation lines of multi-line
 * quoted values. Records each key's first line (`parseEnv` returns keys
 * sorted) and rewrites tabs after `export` on assignment lines only, so
 * quoted values reach `parseEnv` unchanged.
 */
function scanAssignments(source: string): {
  text: string;
  order: Map<string, number>;
} {
  const order = new Map<string, number>();
  let openQuote: string | undefined;
  const lines = source.split(/(\r?\n)/);
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index]!;
    if (openQuote !== undefined) {
      if (line.includes(openQuote)) openQuote = undefined;
      continue;
    }
    const match = ASSIGNMENT.exec(line);
    if (!match) continue;
    const [, key, rest] = match as unknown as [string, string, string];
    if (!order.has(key)) order.set(key, index);
    lines[index] = line.replace(/^([ \t]*)export\t+/, "$1export ");
    const quote = rest[0];
    if (
      (quote === '"' || quote === "'" || quote === "`") &&
      !rest.slice(1).includes(quote)
    )
      openQuote = quote;
  }
  return { text: lines.join(""), order };
}
