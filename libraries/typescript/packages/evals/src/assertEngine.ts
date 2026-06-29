import type { MCPSession } from "mcp-use/client";
import type { AssertRule } from "./schema/suite.v1.js";
import { deepEqual, matchWidgetFields } from "./argMatchers.js";
import { evalJsonPath, resolveFromResultUri } from "./jsonPath.js";

export type AssertOutcome = {
  kind: string;
  passed: boolean;
  reason: string;
};

export async function runAssertRules(
  session: MCPSession,
  rules: AssertRule[],
  context: { callResult?: unknown; root?: unknown }
): Promise<AssertOutcome[]> {
  const outcomes: AssertOutcome[] = [];
  const root = context.root ?? context.callResult ?? {};
  for (const rule of rules) {
    outcomes.push(await runAssertRule(session, rule, root, context.callResult));
  }
  return outcomes;
}

async function runAssertRule(
  session: MCPSession,
  rule: AssertRule,
  root: unknown,
  callResult?: unknown
): Promise<AssertOutcome> {
  switch (rule.kind) {
    case "executionError": {
      const isError = Boolean((root as { isError?: boolean }).isError);
      const expected = rule.equals === false;
      const passed = expected ? !isError : isError;
      return {
        kind: rule.kind,
        passed,
        reason: passed ? "executionError matches" : `isError=${isError}`,
      };
    }
    case "jsonpath": {
      const path = rule.path ?? "$";
      const actual = evalJsonPath(root, path);
      if (rule.equals !== undefined) {
        const passed = deepEqual(actual, rule.equals);
        return {
          kind: rule.kind,
          passed,
          reason: passed
            ? `${path} equals expected`
            : `${path}: expected ${JSON.stringify(rule.equals)}, got ${JSON.stringify(actual)}`,
        };
      }
      if (rule.type === "number") {
        const passed = typeof actual === "number";
        return { kind: rule.kind, passed, reason: passed ? "is number" : `got ${typeof actual}` };
      }
      return { kind: rule.kind, passed: actual !== undefined, reason: `${path}=${JSON.stringify(actual)}` };
    }
    case "equals":
    case "contains":
    case "pattern": {
      const path = rule.path ?? "$.structuredContent";
      const actual = evalJsonPath(root, path);
      const actualStr = String(actual ?? "");
      if (rule.kind === "equals") {
        const passed = deepEqual(actual, rule.equals);
        return {
          kind: rule.kind,
          passed,
          reason: passed ? "equals" : `expected ${JSON.stringify(rule.equals)}, got ${JSON.stringify(actual)}`,
        };
      }
      if (rule.kind === "contains") {
        const needle = rule.contains ?? "";
        const passed = actualStr.toLowerCase().includes(needle.toLowerCase());
        return { kind: rule.kind, passed, reason: passed ? "contains match" : `missing "${needle}"` };
      }
      const pat = rule.pattern ?? "";
      const passed = new RegExp(pat, "i").test(actualStr);
      return { kind: rule.kind, passed, reason: passed ? "pattern match" : `pattern ${pat} failed` };
    }
    case "outputSchemaValid": {
      const sc = (root as { structuredContent?: unknown }).structuredContent;
      const passed = sc !== undefined && sc !== null;
      return {
        kind: rule.kind,
        passed,
        reason: passed ? "structuredContent present" : "missing structuredContent",
      };
    }
    case "resource": {
      const uri = resolveFromResultUri(rule.uri ?? "", callResult ?? root);
      const resource = await session.readResource(uri);
      const contents = resource.contents ?? [];
      const text = contents
        .map((c) => ("text" in c ? c.text : ""))
        .filter(Boolean)
        .join("\n");
      const nested = (rule.assert ?? []) as AssertRule[];
      const nestedOutcomes = await runAssertRules(
        session,
        nested.map((n) => ({ ...n, path: n.path ?? "$" })),
        { root: { text, contents }, callResult: { text, contents } }
      );
      const passed = nestedOutcomes.every((o) => o.passed);
      return {
        kind: rule.kind,
        passed,
        reason: passed ? "resource assertions passed" : nestedOutcomes.map((o) => o.reason).join("; "),
      };
    }
    case "widget": {
      const fields = rule.fields ?? {};
      const sc = (root as { structuredContent?: Record<string, unknown> }).structuredContent;
      const { passed, reason } = matchWidgetFields(fields, sc);
      return { kind: rule.kind, passed, reason };
    }
    default:
      return { kind: String(rule.kind), passed: false, reason: "unknown assert kind" };
  }
}

export function extractStructuredContent(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const sc = (result as { structuredContent?: unknown }).structuredContent;
  if (sc && typeof sc === "object" && !Array.isArray(sc)) {
    return sc as Record<string, unknown>;
  }
  return undefined;
}
