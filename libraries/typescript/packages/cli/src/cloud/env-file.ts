import { parseEnv } from "node:util";

import { UsageError } from "../core/errors.js";

const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse dotenv text with Node's parser, the one behind `process.loadEnvFile`
 * that `mcp-use dev` and `mcp-use start` use for `.env`. A file therefore
 * uploads the same values it produces locally: quotes are removed, inline
 * comments are dropped, `\n` expands inside double quotes, and quoted values
 * may span lines. Assignments keep their file order. Values stay inside the
 * process and never appear in errors.
 */
export function parseEnvFile(source: string): { key: string; value: string }[] {
  return Object.entries(parseEnv(source))
    .map(([key, value]) => {
      if (!ENVIRONMENT_KEY.test(key))
        throw new UsageError(
          `Invalid environment variable name in file: ${key}`
        );
      return {
        key,
        value: value ?? "",
        position: firstAssignment(source, key),
      };
    })
    .sort((a, b) => a.position - b.position)
    .map(({ key, value }) => ({ key, value }));
}

/** Offset of the first line that assigns `key`; `parseEnv` sorts its keys. */
function firstAssignment(source: string, key: string): number {
  const position = source.search(
    new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=`, "m")
  );
  return position === -1 ? Number.MAX_SAFE_INTEGER : position;
}
