import type { CheckResult } from "./checks.js";
import type { ScenarioRunResult } from "./agentRunner.js";

export type SuiteMetrics = {
  checks: { total: number; passed: number };
  scenarios: {
    total: number;
    passed: number;
    passRate: number;
    agentStepsP95?: number;
    toolErrorRate: number;
  };
  tokens: {
    prompt: number;
    completion: number;
    total: number;
    costUsd?: number;
    /** p95 of total tokens across the scenarios that passed. */
    perSuccessP95?: number;
  };
  byClient: Record<string, { passRate: number; count: number }>;
  gates: { passed: boolean; violations: string[] };
};

function p95(sortedAsc: number[]): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.floor(sortedAsc.length * 0.95);
  return sortedAsc[Math.min(idx, sortedAsc.length - 1)]!;
}

export function aggregateMetrics(
  checkResults: CheckResult[],
  scenarioResults: ScenarioRunResult[],
  gates?: {
    toolErrorRateMax?: number;
    agentStepsP95Max?: number;
    tokensPerSuccessP95Max?: number;
  }
): SuiteMetrics {
  const checksPassed = checkResults.filter((c) => c.passed).length;
  const scenariosPassed = scenarioResults.filter((s) => s.success).length;
  const steps = scenarioResults.map((s) => s.agentSteps).sort((a, b) => a - b);
  const agentStepsP95 = p95(steps);

  const toolErrors = scenarioResults.reduce((n, s) => n + s.errors.length, 0);
  const toolErrorRate = scenarioResults.length ? toolErrors / scenarioResults.length : 0;

  const promptTokens = scenarioResults.reduce((n, s) => n + s.usage.promptTokens, 0);
  const completionTokens = scenarioResults.reduce((n, s) => n + s.usage.completionTokens, 0);
  const totalTokens = scenarioResults.reduce((n, s) => n + s.usage.totalTokens, 0);
  const costUsd = scenarioResults.reduce((n, s) => n + (s.usage.costUsd ?? 0), 0);
  const successTokens = scenarioResults
    .filter((s) => s.success)
    .map((s) => s.usage.totalTokens)
    .sort((a, b) => a - b);
  const tokensPerSuccessP95 = p95(successTokens);

  const violations: string[] = [];
  if (gates?.toolErrorRateMax !== undefined && toolErrorRate > gates.toolErrorRateMax) {
    violations.push(`toolErrorRate ${toolErrorRate} > ${gates.toolErrorRateMax}`);
  }
  if (gates?.agentStepsP95Max !== undefined && (agentStepsP95 ?? 0) > gates.agentStepsP95Max) {
    violations.push(`agentStepsP95 ${agentStepsP95} > ${gates.agentStepsP95Max}`);
  }
  if (
    gates?.tokensPerSuccessP95Max !== undefined &&
    tokensPerSuccessP95 > gates.tokensPerSuccessP95Max
  ) {
    violations.push(
      `tokensPerSuccessP95 ${tokensPerSuccessP95} > ${gates.tokensPerSuccessP95Max}`
    );
  }

  return {
    checks: { total: checkResults.length, passed: checksPassed },
    scenarios: {
      total: scenarioResults.length,
      passed: scenariosPassed,
      passRate: scenarioResults.length ? scenariosPassed / scenarioResults.length : 1,
      agentStepsP95,
      toolErrorRate,
    },
    tokens: {
      prompt: promptTokens,
      completion: completionTokens,
      total: totalTokens,
      ...(costUsd > 0 ? { costUsd } : {}),
      perSuccessP95: tokensPerSuccessP95,
    },
    byClient: {
      "mcp-use": {
        passRate: scenarioResults.length ? scenariosPassed / scenarioResults.length : 1,
        count: scenarioResults.length,
      },
    },
    gates: { passed: violations.length === 0, violations },
  };
}
