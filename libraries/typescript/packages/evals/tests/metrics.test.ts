import { describe, expect, it } from "vitest";
import { aggregateMetrics } from "../src/metrics.js";
import { addUsage, emptyUsage } from "../src/usage.js";
import type { ScenarioRunResult } from "../src/agentRunner.js";

function scenario(overrides: Partial<ScenarioRunResult> = {}): ScenarioRunResult {
  return {
    scenarioId: "s",
    client: "mcp-use",
    model: "openai/gpt-4o-mini",
    systemPrompt: "default",
    success: true,
    toolTracePassed: true,
    resultPassed: true,
    widgetPassed: true,
    judgePassed: true,
    toolCalls: [],
    durationMs: 1000,
    agentSteps: 3,
    usage: emptyUsage(),
    errors: [],
    ...overrides,
  };
}

describe("addUsage", () => {
  it("sums fields and only sets cost when reported", () => {
    const acc = emptyUsage();
    addUsage(acc, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    addUsage(acc, { promptTokens: 1, completionTokens: 2, totalTokens: 3, costUsd: 0.01 });
    addUsage(acc, undefined);
    expect(acc).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18, costUsd: 0.01 });
  });
});

describe("aggregateMetrics tokens", () => {
  it("rolls up token totals across scenarios", () => {
    const m = aggregateMetrics(
      [],
      [
        scenario({ usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140, costUsd: 0.02 } }),
        scenario({ usage: { promptTokens: 60, completionTokens: 20, totalTokens: 80 } }),
      ]
    );
    expect(m.tokens.prompt).toBe(160);
    expect(m.tokens.completion).toBe(60);
    expect(m.tokens.total).toBe(220);
    expect(m.tokens.costUsd).toBeCloseTo(0.02);
  });

  it("flags a tokensPerSuccessP95Max gate violation only for passing scenarios", () => {
    const results = [
      scenario({ success: true, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 500 } }),
      scenario({ success: false, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 9000 } }),
    ];
    const violating = aggregateMetrics([], results, { tokensPerSuccessP95Max: 100 });
    expect(violating.gates.passed).toBe(false);
    expect(violating.gates.violations.some((v) => v.includes("tokensPerSuccessP95"))).toBe(true);

    const ok = aggregateMetrics([], results, { tokensPerSuccessP95Max: 1000 });
    expect(ok.gates.passed).toBe(true);
  });
});
