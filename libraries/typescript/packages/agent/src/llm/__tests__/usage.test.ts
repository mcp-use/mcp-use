import { describe, expect, it } from "vitest";
import { mergeTokenUsage, tokenUsageFromRecord } from "../usage.js";

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
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 2 },
      })
    ).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      cachedInputTokens: 3,
      reasoningTokens: 2,
    });
  });

  it("preserves Responses API usage details", () => {
    expect(
      tokenUsageFromRecord({
        input_tokens: 10,
        output_tokens: 4,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 2 },
      })
    ).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      cachedInputTokens: 3,
      reasoningTokens: 2,
    });
  });

  it("preserves zero-valued Chat Completions usage details", () => {
    expect(
      tokenUsageFromRecord({
        prompt_tokens: 10,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
      })
    ).toMatchObject({ cachedInputTokens: 0, reasoningTokens: 0 });
  });

  it("prefers normalized counters over provider usage details", () => {
    expect(
      tokenUsageFromRecord({
        cachedInputTokens: 0,
        reasoningTokens: 0,
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 2 },
      })
    ).toMatchObject({ cachedInputTokens: 0, reasoningTokens: 0 });
  });

  it.each([
    { prompt_tokens_details: null, completion_tokens_details: null },
    { prompt_tokens_details: "invalid", completion_tokens_details: 2 },
    {
      prompt_tokens_details: { cached_tokens: "3" },
      completion_tokens_details: { reasoning_tokens: Infinity },
    },
  ])("ignores invalid usage details: %j", (details) => {
    expect(tokenUsageFromRecord(details)).toBeUndefined();
  });

  it("does not fabricate usage when counters are absent", () => {
    expect(tokenUsageFromRecord({ duration_ms: 42 })).toBeUndefined();
  });
});

describe("Anthropic cache counters", () => {
  it("counts every billed input token in totalTokens", () => {
    // Anthropic reports input_tokens NET of the cache and bills all three counters, so
    // input_tokens + output_tokens is not what the call is charged on.
    expect(
      tokenUsageFromRecord({
        input_tokens: 3,
        cache_read_input_tokens: 20000,
        cache_creation_input_tokens: 1500,
        output_tokens: 120,
      })
    ).toMatchObject({
      inputTokens: 3,
      outputTokens: 120,
      cachedInputTokens: 20000,
      cacheCreationInputTokens: 1500,
      totalTokens: 21623,
    });
  });

  it("does not add OpenAI cached tokens, which are already inside prompt_tokens", () => {
    expect(
      tokenUsageFromRecord({
        prompt_tokens: 10,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 3 },
      })
    ).toMatchObject({ cachedInputTokens: 3, totalTokens: 14 });
  });
});

describe("mergeTokenUsage", () => {
  it("keeps counters that the later record does not mention", () => {
    // Anthropic's streaming message_delta carries output_tokens only. A spread merge
    // overwrote inputTokens and cachedInputTokens with undefined, because
    // tokenUsageFromRecord returns every key and sets the absent ones to undefined.
    const start = tokenUsageFromRecord({
      input_tokens: 3,
      cache_read_input_tokens: 20000,
      cache_creation_input_tokens: 1500,
      output_tokens: 1,
    });
    const delta = tokenUsageFromRecord({ output_tokens: 500 });

    // Cache creation is billed above the base rate, so it has to survive the merge for the
    // same reason cache reads do.
    expect(mergeTokenUsage(start, delta)).toMatchObject({
      inputTokens: 3,
      cachedInputTokens: 20000,
      cacheCreationInputTokens: 1500,
      outputTokens: 500,
    });
  });

  it("returns whichever side is present when the other is undefined", () => {
    const only = tokenUsageFromRecord({ output_tokens: 7 });
    expect(mergeTokenUsage(undefined, only)).toBe(only);
    expect(mergeTokenUsage(only, undefined)).toBe(only);
  });
});
