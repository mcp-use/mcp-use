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

/** Normalize exact provider-reported token counters. Never estimates usage. */
export function tokenUsageFromRecord(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as Record<string, unknown>;
  const inputTokens = numberAt(
    usage,
    "inputTokens",
    "input_tokens",
    "prompt_tokens",
    "promptTokenCount",
    "prompt_eval_count"
  );
  const outputTokens = numberAt(
    usage,
    "outputTokens",
    "output_tokens",
    "completion_tokens",
    "candidatesTokenCount",
    "eval_count"
  );
  // Anthropic reports cache counters ALONGSIDE input_tokens and bills all of them, so
  // input_tokens alone is not what the call is charged on. OpenAI reports cached_tokens
  // INSIDE prompt_tokens, so adding that one would double count. Only the Anthropic-shaped
  // keys are summed here.
  const cacheReadOutsideInput = numberAt(usage, "cache_read_input_tokens");
  const cacheCreationInputTokens = numberAt(
    usage,
    "cacheCreationInputTokens",
    "cache_creation_input_tokens"
  );
  const uncountedCache =
    (cacheReadOutsideInput ?? 0) + (cacheCreationInputTokens ?? 0);

  const totalTokens =
    numberAt(usage, "totalTokens", "total_tokens", "totalTokenCount") ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens + uncountedCache
      : undefined);

  const inputDetails =
    usage.input_tokens_details && typeof usage.input_tokens_details === "object"
      ? (usage.input_tokens_details as Record<string, unknown>)
      : undefined;
  const outputDetails =
    usage.output_tokens_details &&
    typeof usage.output_tokens_details === "object"
      ? (usage.output_tokens_details as Record<string, unknown>)
      : undefined;
  const cachedInputTokens =
    numberAt(usage, "cachedInputTokens", "cache_read_input_tokens") ??
    (inputDetails ? numberAt(inputDetails, "cached_tokens") : undefined);
  const reasoningTokens =
    numberAt(usage, "reasoningTokens", "thoughtsTokenCount") ??
    (outputDetails ? numberAt(outputDetails, "reasoning_tokens") : undefined);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cachedInputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    reasoningTokens,
  };
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
