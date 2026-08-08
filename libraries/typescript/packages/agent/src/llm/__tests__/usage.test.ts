import { describe, expect, it } from "vitest";
import { tokenUsageFromRecord } from "../usage.js";

describe("tokenUsageFromRecord", () => {
  it("maps exact counters from common provider shapes", () => {
    expect(
      tokenUsageFromRecord({
        promptTokenCount: 12,
        candidatesTokenCount: 5,
        totalTokenCount: 17,
      })
    ).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
      cachedInputTokens: undefined,
      reasoningTokens: undefined,
    });

    expect(
      tokenUsageFromRecord({
        prompt_tokens: 10,
        completion_tokens: 4,
        input_tokens_details: { cached_tokens: 3 },
      })
    ).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      cachedInputTokens: 3,
    });
  });

  it("does not fabricate usage when counters are absent", () => {
    expect(tokenUsageFromRecord({ duration_ms: 42 })).toBeUndefined();
  });
});
