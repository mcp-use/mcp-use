#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { runSuite } from "./runSuite.js";
import type { ServerConnection } from "./mcpConnection.js";

const HELP = `mcp-use-evals — run an MCP eval suite (mcp-use.com/evals/v1)

Usage:
  mcp-use-evals run --eval-suite <path> [options]

Options:
  --eval-suite, --suite <path>  Path to the suite YAML (required)
  --server-url <url>            Remote MCP server URL (overrides suite.server)
  --server-config <json>        MCP server config JSON: {"url"} or {"command","args","env"}
  --output <dir>                Output directory for results.json/report.md (default: eval-results)
  --filter <substr>             Only run scenarios whose id contains this substring
  --models <a,b>                Comma-separated model override (OpenRouter ids)
  --judge-model <id>            Judge model override
  --max-steps <n>               Max agent steps per scenario
  --clients <a,b>               Comma-separated client filter (default: mcp-use)
  --skip-agent                  Run deterministic checks only (no agent scenarios)
  --no-fail                     Always exit 0, even when the suite fails
  -h, --help                    Show this help

Env:
  OPENROUTER_API_KEY            Required for agent scenarios and the LLM judge.
`;

function parseServerConnection(raw: string): ServerConnection {
  let cfg: { url?: string; headers?: Record<string, string>; command?: string; args?: string[]; env?: Record<string, string> };
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `--server-config is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (typeof cfg.url === "string") {
    return { type: "url", url: cfg.url, headers: cfg.headers };
  }
  if (typeof cfg.command === "string") {
    return { type: "stdio", command: cfg.command, args: cfg.args ?? [], env: cfg.env };
  }
  throw new Error('--server-config must contain either "url" or "command"');
}

function splitList(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  const items = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "eval-suite": { type: "string" },
      suite: { type: "string" },
      "server-url": { type: "string" },
      "server-config": { type: "string" },
      output: { type: "string" },
      filter: { type: "string" },
      models: { type: "string" },
      "judge-model": { type: "string" },
      "max-steps": { type: "string" },
      clients: { type: "string" },
      "skip-agent": { type: "boolean" },
      "no-fail": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }

  // Allow an optional leading "run" verb (`mcp-use-evals run ...`).
  const verb = positionals[0];
  if (verb && verb !== "run") {
    console.error(`Unknown command: ${verb}\n`);
    console.error(HELP);
    return 2;
  }

  const suitePath = values["eval-suite"] ?? values.suite;
  if (!suitePath) {
    console.error("Error: --eval-suite <path> is required\n");
    console.error(HELP);
    return 2;
  }

  const serverConnection = values["server-config"]
    ? parseServerConnection(values["server-config"])
    : undefined;

  const outputDir = path.resolve(values.output ?? "eval-results");
  const maxSteps = values["max-steps"] ? Number(values["max-steps"]) : undefined;
  if (maxSteps !== undefined && Number.isNaN(maxSteps)) {
    console.error("Error: --max-steps must be a number");
    return 2;
  }

  const result = await runSuite({
    suitePath,
    serverUrl: values["server-url"],
    serverConnection,
    outputDir,
    filter: values.filter,
    models: splitList(values.models),
    clients: splitList(values.clients),
    judgeModel: values["judge-model"],
    maxAgentSteps: maxSteps,
    skipAgent: values["skip-agent"],
  });

  const resultsJson = path.join(outputDir, "results.json");
  const reportMd = path.join(outputDir, "report.md");

  console.log(result.reportMd);
  console.log(`\nResults: ${resultsJson}`);
  console.log(`Report:  ${reportMd}`);
  console.log(`Passed:  ${result.passed}`);

  // Expose paths + pass/fail to GitHub Actions when present.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `results_json=${resultsJson}\nreport_md=${reportMd}\npassed=${result.passed}\n`
    );
  }

  return result.passed || values["no-fail"] ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
