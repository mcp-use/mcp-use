import type { CompleteResourceTemplateCallback } from "@modelcontextprotocol/server";

import { createPrefixCompletion } from "./completable.js";
import type { ResourceTemplateCompleter } from "./resources.js";

/**
 * Convert public static and callback completions to the SDK callback map.
 *
 * @param completions - Public completion providers keyed by template variable.
 * @returns The callback-only map required by the official SDK.
 *
 * @internal
 */
export function normalizeCompletions(
  completions: Readonly<Record<string, ResourceTemplateCompleter | undefined>>
): Record<string, CompleteResourceTemplateCallback> {
  const normalized = Object.create(null) as Record<
    string,
    CompleteResourceTemplateCallback
  >;
  for (const [variable, completer] of Object.entries(completions)) {
    if (completer === undefined) continue;
    normalized[variable] = Array.isArray(completer)
      ? createPrefixCompletion(completer)
      : (completer as CompleteResourceTemplateCallback);
  }
  return normalized;
}
