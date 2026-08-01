/**
 * Token/cost accounting shared across the agent run and the LLM judge.
 *
 * Counts are real provider-reported numbers when available (OpenRouter/OpenAI
 * usage chunks). `costUsd` is only populated when the provider reports it.
 */
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd?: number;
};

export function emptyUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

/** Adds `add` into `into` in place. Missing fields count as zero. */
export function addUsage(into: TokenUsage, add: Partial<TokenUsage> | undefined): void {
  if (!add) return;
  into.promptTokens += add.promptTokens ?? 0;
  into.completionTokens += add.completionTokens ?? 0;
  into.totalTokens += add.totalTokens ?? 0;
  if (add.costUsd !== undefined) {
    into.costUsd = (into.costUsd ?? 0) + add.costUsd;
  }
}
