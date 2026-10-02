import type { MetaObject } from "@modelcontextprotocol/server";

import type { ToolDefinition } from "../tools.js";

const META_KEY = "openai/ui";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Merge typed entrypoints while preserving unrelated vendor metadata. @internal */
export function buildEntrypointMeta(
  definition: ToolDefinition
): MetaObject | undefined {
  const entrypoints = definition.view?.entrypoints;
  if (entrypoints === undefined) return definition._meta;
  const existing = definition._meta?.[META_KEY];
  return {
    ...definition._meta,
    [META_KEY]: {
      ...(record(existing) ? existing : {}),
      entrypoints: entrypoints.map((entry) =>
        entry.type === "file"
          ? { type: entry.type, extensions: [...entry.extensions] }
          : { type: entry.type }
      ),
    },
  };
}
