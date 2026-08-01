import type { EvalCheck } from "./schema/suite.v1.js";
import type { ConnectedMcp } from "./mcpConnection.js";
import { runAssertRules, type AssertOutcome } from "./assertEngine.js";

export type CheckResult = {
  id: string;
  passed: boolean;
  outcomes: AssertOutcome[];
  durationMs: number;
  output?: unknown;
  error?: string;
};

export async function runChecks(
  conn: ConnectedMcp,
  checks: EvalCheck[],
  timeoutMs: number
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    const start = Date.now();
    const outcomes: AssertOutcome[] = [];
    let output: unknown;
    let error: string | undefined;
    try {
      if (check.call.tool) {
        const callResult = await conn.session.callTool(check.call.tool, check.call.args ?? {});
        output = callResult;
        outcomes.push(
          ...(await runAssertRules(conn.session, check.assert, { callResult, root: callResult }))
        );
      } else if (check.call.resource) {
        const resource = await conn.session.readResource(check.call.resource);
        output = resource;
        outcomes.push(
          ...(await runAssertRules(conn.session, check.assert, {
            callResult: resource,
            root: resource,
          }))
        );
      } else if (check.call.mcp === "listTools") {
        const tools = await conn.session.listTools();
        output = tools;
        outcomes.push(
          ...(await runAssertRules(conn.session, check.assert, { callResult: tools, root: tools }))
        );
      } else if (check.call.mcp === "listResources") {
        const resources = await conn.session.listResources();
        output = resources;
        outcomes.push(
          ...(await runAssertRules(conn.session, check.assert, {
            callResult: resources,
            root: resources,
          }))
        );
      } else if (check.call.mcp === "listPrompts") {
        const prompts = await conn.session.listPrompts();
        output = prompts;
        outcomes.push(
          ...(await runAssertRules(conn.session, check.assert, {
            callResult: prompts,
            root: prompts,
          }))
        );
      } else {
        outcomes.push({ kind: "call", passed: false, reason: "check must specify tool, resource, or mcp operation" });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      outcomes.push({
        kind: "call",
        passed: false,
        reason: error,
      });
    }
    results.push({
      id: check.id,
      passed: outcomes.every((o) => o.passed),
      outcomes,
      durationMs: Date.now() - start,
      ...(output !== undefined ? { output } : {}),
      ...(error ? { error } : {}),
    });
  }
  return results;
}
