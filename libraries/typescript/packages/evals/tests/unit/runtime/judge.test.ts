import { describe, expect, it } from "vitest";
import { parseJudgeResponse } from "../../../src/runtime/judge.js";

describe("parseJudgeResponse", () => {
  it("parses score and reasoning from JSON", () => {
    const result = parseJudgeResponse(
      '{"score": 0.9, "reasoning": "Very similar"}'
    );

    expect(result.score).toBeCloseTo(0.9);
    expect(result.reasoning).toBe("Very similar");
  });

  it("throws on invalid content", () => {
    expect(() => parseJudgeResponse("not json")).toThrow();
  });
});
