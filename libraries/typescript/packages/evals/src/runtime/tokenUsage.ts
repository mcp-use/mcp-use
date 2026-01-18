import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { TokenUsage } from "./types.js";

/**
 * Snapshot of token usage at a point in time.
 */
export type TokenUsageSnapshot = {
  /** Number of input tokens */
  inputTokens: number;
  /** Number of output tokens */
  outputTokens: number;
  /** Total tokens (input + output) */
  totalTokens: number;
};

/**
 * Extract token usage information from LangChain LLM output.
 * Handles different output formats from various providers (OpenAI, Anthropic, etc).
 *
 * @param output - LangChain LLM output object
 * @returns Token usage snapshot or null if not available
 * @internal
 */
export function extractTokenUsage(output: any): TokenUsageSnapshot | null {
  const usage =
    output?.llmOutput?.tokenUsage ||
    output?.llmOutput?.usage ||
    output?.generations?.[0]?.[0]?.generationInfo?.usage;

  if (!usage) return null;

  return {
    inputTokens: usage.promptTokens ?? usage.input_tokens ?? 0,
    outputTokens: usage.completionTokens ?? usage.output_tokens ?? 0,
    totalTokens: usage.totalTokens ?? usage.total_tokens ?? 0,
  };
}

/**
 * LangChain callback handler that tracks token usage across LLM calls.
 * Accumulates token counts into a mutable TokenUsage object.
 *
 * @internal
 */
export class TokenTrackingCallback extends BaseCallbackHandler {
  name = "token_tracking";
  private usage: TokenUsage;

  /**
   * Create a token tracking callback.
   *
   * @param usage - Mutable TokenUsage object to accumulate into
   */
  constructor(usage: TokenUsage) {
    super();
    this.usage = usage;
  }

  /**
   * Called when LLM completes. Extracts and accumulates token usage.
   *
   * @param output - LangChain LLM output object
   */
  async handleLLMEnd(output: any) {
    const snapshot = extractTokenUsage(output);
    if (!snapshot) return;

    this.usage.inputTokens += snapshot.inputTokens;
    this.usage.outputTokens += snapshot.outputTokens;
    this.usage.totalTokens += snapshot.totalTokens;
  }
}
