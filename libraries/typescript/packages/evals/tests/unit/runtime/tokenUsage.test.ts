import { describe, expect, it } from "vitest";
import { extractTokenUsage } from "../../../src/runtime/tokenUsage.js";

describe("extractTokenUsage", () => {
  it("extracts from llmOutput.tokenUsage", () => {
    const usage = extractTokenUsage({
      llmOutput: {
        tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      },
    });

    expect(usage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3 });
  });

  it("extracts from generationInfo.usage", () => {
    const usage = extractTokenUsage({
      generations: [
        [
          {
            generationInfo: {
              usage: { input_tokens: 4, output_tokens: 5, total_tokens: 9 },
            },
          },
        ],
      ],
    });

    expect(usage).toEqual({ inputTokens: 4, outputTokens: 5, totalTokens: 9 });
  });

  it("returns null when no usage present", () => {
    const usage = extractTokenUsage({});
    expect(usage).toBeNull();
  });
});
