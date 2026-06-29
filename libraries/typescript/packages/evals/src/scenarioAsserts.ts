import type { AssertRule } from "./schema/suite.v1.js";
import type { MCPSession } from "mcp-use/client";
import { matchArgs } from "./argMatchers.js";
import { runAssertRules, extractStructuredContent } from "./assertEngine.js";
import type { CapturedToolCall } from "./toolTrace.js";

export type ToolAssertionCheck = {
  tool: string;
  passed: boolean;
  reason: string;
  expectedArgs?: Record<string, unknown>;
};

export function runToolTraceAssertions(
  expected: Array<{ name: string; args?: Record<string, unknown>; afterTurn?: number }>,
  actual: CapturedToolCall[]
): { passed: boolean; checks: ToolAssertionCheck[] } {
  const checks: ToolAssertionCheck[] = [];
  for (const exp of expected) {
    const pool = actual.filter(
      (tc) => exp.afterTurn === undefined || tc.turnIndex >= exp.afterTurn
    );
    const matching = pool.filter((tc) => tc.tool === exp.name);
    if (matching.length === 0) {
      checks.push({
        tool: exp.name,
        passed: false,
        reason:
          exp.afterTurn !== undefined
            ? `tool not called at or after turn ${exp.afterTurn}`
            : "tool was not called",
        expectedArgs: exp.args,
      });
      continue;
    }
    if (!exp.args || Object.keys(exp.args).length === 0) {
      checks.push({ tool: exp.name, passed: true, reason: "tool was called", expectedArgs: exp.args });
      continue;
    }
    const anyMatch = matching.some((tc) => matchArgs(exp.args!, tc.args ?? {}));
    checks.push({
      tool: exp.name,
      passed: anyMatch,
      reason: anyMatch ? "args match" : "args did not match",
      expectedArgs: exp.args,
    });
  }
  return { passed: checks.every((c) => c.passed), checks };
}

export async function runResultAssertions(
  session: MCPSession,
  expected: { tool: string; assert: AssertRule[] },
  actual: CapturedToolCall[]
): Promise<{ passed: boolean; outcomes: Awaited<ReturnType<typeof runAssertRules>> }> {
  const call = [...actual].reverse().find((c) => c.tool === expected.tool);
  if (!call?.result) {
    return {
      passed: false,
      outcomes: [{ kind: "result", passed: false, reason: `no result for tool ${expected.tool}` }],
    };
  }
  const outcomes = await runAssertRules(session, expected.assert, {
    callResult: call.result,
    root: call.result,
  });
  return { passed: outcomes.every((o) => o.passed), outcomes };
}

export function assertForbiddenTools(
  forbidden: string[],
  actual: CapturedToolCall[]
): { passed: boolean; reason: string } {
  const hit = forbidden.filter((f) => actual.some((c) => c.tool === f));
  if (hit.length > 0) {
    return { passed: false, reason: `forbidden tools called: ${hit.join(", ")}` };
  }
  return { passed: true, reason: "no forbidden tools" };
}

export function findToolResultForWidget(
  actual: CapturedToolCall[],
  toolName?: string
): CapturedToolCall | undefined {
  if (toolName) {
    return [...actual].reverse().find((c) => c.tool === toolName);
  }
  return actual[actual.length - 1];
}

export function getStructuredFromCall(call: CapturedToolCall | undefined): Record<string, unknown> | undefined {
  if (!call) return undefined;
  if (call.structuredContent) return call.structuredContent;
  return extractStructuredContent(call.result);
}
