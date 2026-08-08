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
  const totalTokens =
    numberAt(usage, "totalTokens", "total_tokens", "totalTokenCount") ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
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
    reasoningTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    reasoningTokens,
  };
}
