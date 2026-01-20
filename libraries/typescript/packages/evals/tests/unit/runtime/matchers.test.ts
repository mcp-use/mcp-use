import { describe, expect, it } from "vitest";
import type { EvalResult } from "../../../src/runtime/types.js";
import "../../../src/runtime/matchers.js";

function makeResult(overrides: Partial<EvalResult> = {}): EvalResult {
  const base: EvalResult = {
    input: "prompt",
    output: "The result is sunny",
    toolCalls: [
      {
        name: "get_weather",
        input: { city: "Tokyo" },
        output: { kind: "json", value: { weather: "sunny" } },
        durationMs: 10,
        startedAt: Date.now() - 10,
      },
    ],
    resourceAccess: [],
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    durationMs: 20,
    followUp: async () => base,
  };
  return { ...base, ...overrides };
}

describe("eval matchers", () => {
  it("asserts tool usage and inputs", () => {
    const result = makeResult();
    expect(result).toHaveUsedTool("get_weather");
    expect(result).toHaveToolCallCount(1);
    expect(result).toHaveToolCallWith("get_weather", { city: "Tokyo" });
  });

  it("asserts tool results and failures", () => {
    const result = makeResult({
      toolCalls: [
        {
          name: "get_weather",
          input: { city: "Atlantis" },
          error: { kind: "text", value: "not found" },
          durationMs: 5,
          startedAt: Date.now() - 5,
        },
      ],
    });

    expect(result).toHaveToolCallFailed("get_weather");
    expect(result).toHaveToolCallFailedWith("get_weather", "not found");
  });

  it("asserts output and usage", () => {
    const result = makeResult();
    expect(result).toHaveOutputContaining("sunny");
    expect(result).toHaveCompletedWithinMs(1000);
    expect(result).toHaveUsedLessThanTokens(10);
  });
});
