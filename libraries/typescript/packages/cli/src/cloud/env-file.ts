import { parseEnv } from "node:util";

import { UsageError } from "../core/errors.js";

const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ASSIGNMENT =
  /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*)$/;

/**
 * Parse dotenv text with Node's parser, the one behind `process.loadEnvFile`
 * that `mcp-use dev` and `mcp-use start` use for `.env`: quotes are removed,
 * inline comments are dropped, `\n` expands inside double quotes, and quoted
 * values may span lines. Assignments keep their file order. Values stay
 * inside the process and never appear in errors.
 */
export function parseEnvFile(source: string): { key: string; value: string }[] {
  const text = source
    .replace(/^\uFEFF/, "")
    .replace(/^([ \t]*)export\t+/gm, "$1export ");
  const order = assignmentOrder(text);
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
 * Line of each key's first assignment, skipping the continuation lines of
 * multi-line quoted values. `parseEnv` returns keys in sorted order.
 */
function assignmentOrder(text: string): Map<string, number> {
  const order = new Map<string, number>();
  let openQuote: string | undefined;
  text.split(/\r?\n/).forEach((line, index) => {
    if (openQuote !== undefined) {
      if (line.includes(openQuote)) openQuote = undefined;
      return;
    }
    const match = ASSIGNMENT.exec(line);
    if (!match) return;
    const [, key, rest] = match as unknown as [string, string, string];
    if (!order.has(key)) order.set(key, index);
    const quote = rest[0];
    if (
      (quote === '"' || quote === "'" || quote === "`") &&
      !rest.slice(1).includes(quote)
    )
      openQuote = quote;
  });
  return order;
}
