import { describe, expect, it } from "vitest";
import { getToolLimitWarning, MODEL_TOOL_LIMITS } from "../tool-limit-warning";

describe("getToolLimitWarning", () => {
  it.each(["openai", "google"])(
    "warns when %s receives more than 128 tools",
    (provider) => {
      expect(getToolLimitWarning(provider, 128)).toBeNull();
      expect(getToolLimitWarning(provider, 129)).toEqual({
        limit: 128,
        toolCount: 129,
      });
    }
  );

  it("normalizes provider names", () => {
    expect(getToolLimitWarning(" Google ", 129)?.limit).toBe(
      MODEL_TOOL_LIMITS.google
    );
  });

  it.each(["anthropic", "openrouter", "openai-compatible", "ollama"])(
    "does not claim an undocumented hard limit for %s",
    (provider) => {
      expect(getToolLimitWarning(provider, 10_000)).toBeNull();
    }
  );
});
