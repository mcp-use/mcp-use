import type { TokenUsage } from "./types.js";

function numberAt(
  value: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function tokenCountsFromRecord(usage: Record<string, unknown>): TokenUsage {
  return {
    inputTokens: numberAt(
      usage,
      "inputTokens",
      "input_tokens",
      "prompt_tokens",
      "promptTokenCount",
      "prompt_eval_count"
    ),
    outputTokens: numberAt(
      usage,
      "outputTokens",
      "output_tokens",
      "completion_tokens",
      "candidatesTokenCount",
      "eval_count"
    ),
  };
}

function cacheCountsFromRecord(usage: Record<string, unknown>): TokenUsage {
  const inputDetails =
    usage.input_tokens_details && typeof usage.input_tokens_details === "object"
      ? (usage.input_tokens_details as Record<string, unknown>)
      : undefined;
  const outputDetails =
    usage.output_tokens_details &&
    typeof usage.output_tokens_details === "object"
      ? (usage.output_tokens_details as Record<string, unknown>)
      : undefined;
  return {
    cachedInputTokens:
      numberAt(
        usage,
        "cachedInputTokens",
        "cache_read_input_tokens",
        "cachedContentTokenCount"
      ) ?? (inputDetails ? numberAt(inputDetails, "cached_tokens") : undefined),
    cacheCreationInputTokens: numberAt(
      usage,
      "cacheCreationInputTokens",
      "cache_creation_input_tokens"
    ),
    reasoningTokens:
      numberAt(usage, "reasoningTokens", "thoughtsTokenCount") ??
      (outputDetails ? numberAt(outputDetails, "reasoning_tokens") : undefined),
  };
}

/** Normalize exact provider-reported token counters. Never estimates usage. */
export function tokenUsageFromRecord(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as Record<string, unknown>;
  const counts = {
    ...tokenCountsFromRecord(usage),
    ...cacheCountsFromRecord(usage),
  };
  // Only Anthropic reports cache counters outside the input token count.
  const uncountedCache =
    (numberAt(usage, "cache_read_input_tokens") ?? 0) +
    (counts.cacheCreationInputTokens ?? 0);
  const { inputTokens, outputTokens } = counts;
  const totalTokens =
    numberAt(usage, "totalTokens", "total_tokens", "totalTokenCount") ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens + uncountedCache
      : undefined);
  const result = { ...counts, totalTokens };
  return Object.values(result).every((value) => value === undefined)
    ? undefined
    : result;
}

/**
 * Merge later counters over earlier ones without letting an absent field erase a present one.
 *
 * `tokenUsageFromRecord` returns every key and sets the ones it did not find to `undefined`,
 * so a spread merge overwrites good values with `undefined`. Anthropic's streaming
 * `message_delta` carries `output_tokens` only, which made a spread wipe the input and cache
 * counters captured at `message_start`.
 *
 * This deliberately does not recompute `totalTokens`. Whether a cache counter is additive
 * depends on the provider (Anthropic reports it outside `input_tokens`, OpenAI inside
 * `prompt_tokens`), and that distinction is gone by the time usage has been normalised. The
 * caller knows its provider and owns the total.
 */
export function mergeTokenUsage(
  base: TokenUsage | undefined,
  next: TokenUsage | undefined
): TokenUsage | undefined {
  if (!base) return next;
  if (!next) return base;
  const merged: TokenUsage = { ...base };
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}
