import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvalSuite } from "./schema/suite.v1.js";
import { loadSuiteFromFile } from "./loadSuite.js";
import {
  connectMcp,
  disconnectMcp,
  serverConfigFromSuite,
  type ServerConnection,
} from "./mcpConnection.js";
import { runChecks, type CheckResult } from "./checks.js";
import { runAgentMatrix, type ScenarioRunResult } from "./agentRunner.js";
import { aggregateMetrics } from "./metrics.js";
import { formatMarkdownReport } from "./report.js";

export type RunSuiteOptions = {
  suitePath?: string;
  suite?: EvalSuite;
  serverUrl?: string;
  serverConnection?: ServerConnection;
  clients?: string[];
  skipAgent?: boolean;
  outputDir?: string;
  /** Override the judge model from the suite defaults. */
  judgeModel?: string;
  /** Override the max agent steps per scenario. */
  maxAgentSteps?: number;
  /** Override the default rubric pass threshold. */
  rubricThreshold?: number;
  /** Override every client's `models` list. */
  models?: string[];
  /** Only run scenarios whose id contains this substring. */
  filter?: string;
};

export type RunSuiteResult = {
  passed: boolean;
  suite: EvalSuite;
  checkResults: CheckResult[];
  scenarioResults: ScenarioRunResult[];
  metrics: ReturnType<typeof aggregateMetrics>;
  reportMd: string;
  resultsJson: unknown;
};

export async function runSuite(options: RunSuiteOptions): Promise<RunSuiteResult> {
  const suite =
    options.suite ??
    (options.suitePath ? await loadSuiteFromFile(options.suitePath) : null);
  if (!suite) throw new Error("suite or suitePath required");

  const defaults = {
    timeoutMs: suite.defaults?.timeoutMs ?? 60_000,
    maxAgentSteps: options.maxAgentSteps ?? suite.defaults?.maxAgentSteps ?? 30,
    judgeModel: options.judgeModel ?? suite.defaults?.judgeModel ?? "openai/gpt-4o-mini",
    rubricThreshold: options.rubricThreshold ?? suite.defaults?.rubricThreshold ?? 0.7,
  };

  const connection =
    options.serverConnection ?? serverConfigFromSuite(suite.server, options.serverUrl);

  const conn = await connectMcp(connection);
  const serverBaseUrl =
    connection.type === "url" ? new URL(connection.url).origin : options.serverUrl;

  const allCheckResults: CheckResult[] = [];
  const allScenarioResults: ScenarioRunResult[] = [];

  try {
    for (const flow of suite.flows) {
      if (flow.type !== "agent") continue;

      if (flow.checks?.length) {
        allCheckResults.push(...(await runChecks(conn, flow.checks, defaults.timeoutMs)));
      }

      const scopedFlow = options.filter
        ? { ...flow, scenarios: flow.scenarios.filter((s) => s.id.includes(options.filter!)) }
        : flow;

      allScenarioResults.push(
        ...(await runAgentMatrix({
          conn,
          flow: scopedFlow,
          serverBaseUrl,
          clientsFilter: options.clients,
          modelsOverride: options.models,
          skipAgent: options.skipAgent,
          defaults: {
            maxAgentSteps: defaults.maxAgentSteps,
            judgeModel: defaults.judgeModel,
            rubricThreshold: defaults.rubricThreshold,
            timeoutMs: defaults.timeoutMs,
          },
        }))
      );
    }
  } finally {
    await disconnectMcp(conn);
  }

  const metrics = aggregateMetrics(allCheckResults, allScenarioResults, suite.metrics?.gates);
  const checksOk = allCheckResults.every((c) => c.passed);
  const scenariosOk = allScenarioResults.every((s) => s.success);
  const passed = checksOk && scenariosOk && metrics.gates.passed;

  const reportMd = formatMarkdownReport({
    suiteName: suite.name,
    passed,
    checkResults: allCheckResults,
    scenarioResults: allScenarioResults,
    metrics,
  });

  const resultsJson = {
    suite: suite.name,
    passed,
    checks: allCheckResults,
    scenarios: allScenarioResults,
    metrics,
  };

  if (options.outputDir) {
    await mkdir(options.outputDir, { recursive: true });
    await writeFile(path.join(options.outputDir, "report.md"), reportMd);
    await writeFile(
      path.join(options.outputDir, "results.json"),
      JSON.stringify(resultsJson, null, 2)
    );
    await writeFile(
      path.join(options.outputDir, "metrics.json"),
      JSON.stringify(metrics, null, 2)
    );
  }

  return {
    passed,
    suite,
    checkResults: allCheckResults,
    scenarioResults: allScenarioResults,
    metrics,
    reportMd,
    resultsJson,
  };
}

export { loadSuiteFromFile } from "./loadSuite.js";
export { API_VERSION } from "./schema/suite.v1.js";
