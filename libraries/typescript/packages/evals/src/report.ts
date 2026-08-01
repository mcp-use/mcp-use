import type { CheckResult } from "./checks.js";
import type { ScenarioRunResult } from "./agentRunner.js";
import type { SuiteMetrics } from "./metrics.js";

function scoreBadge(score: number | undefined, threshold = 0.7): string {
  if (score === undefined) return "—";
  const pct = Math.round(score * 100);
  const dot = score >= threshold ? "🟢" : score >= 0.6 ? "🟡" : "🔴";
  return `${dot} ${pct}%`;
}

function fmtTokens(total: number): string {
  if (total <= 0) return "—";
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k`;
  return String(total);
}

function fmtCost(cost: number | undefined): string {
  if (!cost || cost <= 0) return "";
  return ` ($${cost.toFixed(4)})`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function formatMarkdownReport(params: {
  suiteName: string;
  passed: boolean;
  checkResults: CheckResult[];
  scenarioResults: ScenarioRunResult[];
  metrics: SuiteMetrics;
}): string {
  const { metrics } = params;
  const scenariosPassed = params.scenarioResults.filter((s) => s.success).length;
  const checksPassed = params.checkResults.filter((c) => c.passed).length;

  const lines: string[] = [
    `# Eval report: ${params.suiteName}`,
    "",
    params.passed ? "### ✅ PASSED" : "### ❌ FAILED",
    "",
    `**Scenarios:** ${scenariosPassed}/${params.scenarioResults.length} · ` +
      `**Checks:** ${checksPassed}/${params.checkResults.length} · ` +
      `**Tokens:** ${fmtTokens(metrics.tokens.total)}${fmtCost(metrics.tokens.costUsd)}`,
    "",
  ];

  // Scenario summary table.
  if (params.scenarioResults.length > 0) {
    lines.push("## Scenarios", "");
    lines.push("| Result | Scenario | Client | Model | Prompt | Score | Tokens | Time |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const s of params.scenarioResults) {
      lines.push(
        `| ${s.success ? "✅" : "❌"} ` +
          `| \`${escapeCell(s.scenarioId)}\` ` +
          `| ${escapeCell(s.client)} ` +
          `| ${escapeCell(s.model)} ` +
          `| ${escapeCell(s.systemPrompt)} ` +
          `| ${s.judgePassed === null ? "—" : scoreBadge(s.judgeScore)} ` +
          `| ${fmtTokens(s.usage.totalTokens)} ` +
          `| ${(s.durationMs / 1000).toFixed(1)}s |`
      );
    }
    lines.push("");

    // Collapsible per-scenario details.
    for (const s of params.scenarioResults) {
      const summary = `${s.success ? "✅" : "❌"} ${s.scenarioId} (${s.model})`;
      lines.push("<details>", `<summary>${summary}</summary>`, "");
      if (s.judgeReason) {
        lines.push(`**Judge** ${scoreBadge(s.judgeScore)} — ${s.judgeReason}`, "");
      }
      if (s.toolCalls.length > 0) {
        lines.push("**Tool calls**", "");
        for (const tc of s.toolCalls) {
          lines.push(`- \`${tc.tool}\` ${JSON.stringify(tc.args)}`);
        }
        lines.push("");
      }
      lines.push(
        `**Steps:** ${s.agentSteps} · ` +
          `**Tokens:** ${s.usage.totalTokens} ` +
          `(prompt ${s.usage.promptTokens}, completion ${s.usage.completionTokens})` +
          fmtCost(s.usage.costUsd),
        ""
      );
      if (s.errors.length > 0) {
        lines.push("**Errors**", "");
        for (const e of s.errors) lines.push(`- ${escapeCell(e)}`);
        lines.push("");
      }
      lines.push("</details>", "");
    }
  }

  // Checks section.
  if (params.checkResults.length > 0) {
    lines.push("## Checks", "");
    for (const c of params.checkResults) {
      lines.push(`- ${c.passed ? "✅" : "❌"} \`${c.id}\` (${c.durationMs}ms)`);
      for (const o of c.outcomes.filter((x) => !x.passed)) {
        lines.push(`  - ${escapeCell(o.reason)}`);
      }
    }
    lines.push("");
  }

  // Metrics + gates.
  lines.push("## Metrics", "");
  lines.push(`- Pass rate: ${(metrics.scenarios.passRate * 100).toFixed(0)}%`);
  lines.push(`- Tool error rate: ${metrics.scenarios.toolErrorRate.toFixed(2)}`);
  if (metrics.scenarios.agentStepsP95 !== undefined) {
    lines.push(`- Agent steps p95: ${metrics.scenarios.agentStepsP95}`);
  }
  lines.push(
    `- Tokens: ${metrics.tokens.total} total ` +
      `(prompt ${metrics.tokens.prompt}, completion ${metrics.tokens.completion})` +
      fmtCost(metrics.tokens.costUsd)
  );
  if (metrics.tokens.perSuccessP95) {
    lines.push(`- Tokens per success p95: ${metrics.tokens.perSuccessP95}`);
  }
  if (!metrics.gates.passed) {
    lines.push("", "**Gate violations:**");
    for (const v of metrics.gates.violations) lines.push(`- ❌ ${v}`);
  }

  return lines.join("\n");
}
