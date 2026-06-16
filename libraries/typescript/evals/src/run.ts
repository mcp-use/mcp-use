import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { assertAgentAuth, runClaudeAgent } from "./agent.js";
import { gradeIdiom, collectSourceFiles } from "./graders/idiom.js";
import { DEFAULT_JUDGE_MODEL, gradeWithJudge } from "./graders/judge.js";
import {
  freePort,
  gradeOutcome,
  installedSdkVersion,
} from "./graders/outcome.js";
import { gradeReadiness } from "./graders/readiness.js";
import { startOAuthBackend } from "./oauth-backends.js";
import { consoleSummary, renderReport } from "./report.js";
import { applyGolden, prepareWorkspace, snapshotWorkspace } from "./sandbox.js";
import { listTaskIds, loadTask, RESULTS_DIR } from "./tasks.js";
import {
  ALL_VARIANTS,
  parseVariant,
  variantId,
  type LoadedTask,
  type RunResult,
  type TaskOAuth,
  type TrialResult,
  type Variant,
} from "./types.js";

const HELP = `mcp-use SDK evals (MCP-2072)

Usage: pnpm eval [options]

  --task <id>          task to run (repeatable; default: all tasks)
  --variant <id>       skill+scaffold | skill+blank | noskill+scaffold | noskill+blank | all
                       (default: noskill+blank)
  --trials <n>         trials per task×variant (default: 1; use 3 for recorded runs)
  --model <id>         agent model passed to the Agent SDK (default: SDK default)
  --judge-model <id>   judge model (default: ${DEFAULT_JUDGE_MODEL} — keep pinned across runs)
  --agent <runner>     claude | golden  (golden = copy the task's known-good solution;
                       validates the graders without burning an agent run)
  --skip-judge         skip the LLM judge (with --agent golden: no ANTHROPIC_API_KEY needed)
  --timeout-min <n>    per-trial agent timeout in minutes (default: 20)
  --help
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      task: { type: "string", multiple: true },
      variant: { type: "string", default: "noskill+blank" },
      trials: { type: "string", default: "1" },
      model: { type: "string" },
      "judge-model": { type: "string", default: DEFAULT_JUDGE_MODEL },
      agent: { type: "string", default: "claude" },
      "skip-judge": { type: "boolean", default: false },
      "timeout-min": { type: "string", default: "20" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }

  const taskIds =
    values.task && values.task.length > 0 ? values.task : await listTaskIds();
  const variants: Variant[] =
    values.variant === "all" ? ALL_VARIANTS : [parseVariant(values.variant!)];
  const trialsPer = Number(values.trials);
  const agentRunner = values.agent!;
  const timeoutMs = Number(values["timeout-min"]) * 60_000;
  let judgeEnabled = !values["skip-judge"];

  if (agentRunner === "claude") assertAgentAuth();
  else if (agentRunner !== "golden")
    throw new Error(`unknown agent runner "${agentRunner}"`);
  if (judgeEnabled && !process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "⚠️  ANTHROPIC_API_KEY not set — skipping the LLM judge (deterministic grading still runs)."
    );
    judgeEnabled = false;
  }

  const startedAt = new Date().toISOString();
  const runId = buildRunId({
    taskIds,
    variant: values.variant!,
    agentRunner,
    startedAt,
  });
  const runDir = join(RESULTS_DIR, runId);
  await mkdir(join(runDir, "trials"), { recursive: true });

  const run: RunResult = {
    runId,
    startedAt,
    agentRunner,
    agentModel:
      values.model ?? (agentRunner === "golden" ? "golden" : "default"),
    judgeModel: judgeEnabled ? values["judge-model"]! : "skipped",
    trials: [],
  };

  for (const taskId of taskIds) {
    const task = await loadTask(taskId);
    const taskVariants = variants.filter(
      (v) =>
        !task.config.variants || task.config.variants.includes(variantId(v))
    );
    for (const variant of taskVariants) {
      for (let trial = 1; trial <= trialsPer; trial++) {
        const label = `${taskId} · ${variantId(variant)} · trial ${trial}/${trialsPer}`;
        console.log(`\n▶ ${label}`);
        const result = await runTrial({
          task,
          variant,
          trial,
          agentRunner,
          model: values.model,
          judgeModel: judgeEnabled ? values["judge-model"]! : null,
          timeoutMs,
          runDir,
        });
        run.trials.push(result);
        console.log(
          `  outcome ${result.outcome.score}${result.outcome.success ? " ✅" : ""} · readiness ${result.readiness.score} · penalties ${result.readiness.penalties.length} · judge notes ${result.judge?.processFindings.length ?? "—"}${result.error ? ` · ⚠️ ${result.error}` : ""}`
        );
      }
    }
  }

  await writeFile(join(runDir, "run.json"), JSON.stringify(run, null, 2));
  await writeFile(join(runDir, "report.md"), renderReport(run));
  console.log(`\n${consoleSummary(run)}`);
  console.log(`\nReport: ${join(runDir, "report.md")}`);
}

/**
 * Human-readable run directory name: what ran, then when.
 * e.g. "01-basic-tool-server--noskill+blank--2026-06-11T18-40-40",
 *      "3-tasks--all-variants--golden--2026-06-12T09-15-02"
 */
function buildRunId(opts: {
  taskIds: string[];
  variant: string;
  agentRunner: string;
  startedAt: string;
}): string {
  const taskPart =
    opts.taskIds.length === 1
      ? opts.taskIds[0]
      : `${opts.taskIds.length}-tasks`;
  const variantPart = opts.variant === "all" ? "all-variants" : opts.variant;
  const stamp = opts.startedAt.replace(/[:.]/g, "-").slice(0, 19);
  return [
    taskPart,
    variantPart,
    ...(opts.agentRunner === "golden" ? ["golden"] : []),
    stamp,
  ].join("--");
}

async function runTrial(opts: {
  task: LoadedTask;
  variant: Variant;
  trial: number;
  agentRunner: string;
  model?: string;
  judgeModel: string | null;
  timeoutMs: number;
  runDir: string;
}): Promise<TrialResult> {
  const { task, variant } = opts;
  const vid = variantId(variant);
  const trialDir = join(
    opts.runDir,
    "trials",
    `${task.config.id}--${vid}--t${opts.trial}`
  );
  await mkdir(trialDir, { recursive: true });

  const base: Omit<TrialResult, "outcome" | "idiom" | "readiness" | "judge"> = {
    task: task.config.id,
    variant: vid,
    trial: opts.trial,
    promptHash: task.promptHash,
    agentRunner: opts.agentRunner,
    agentModel:
      opts.model ?? (opts.agentRunner === "golden" ? "golden" : "default"),
    sdkVersion: null,
    durationMs: null,
    turns: null,
    costUsd: null,
    transcriptPath: null,
    timestamp: new Date().toISOString(),
    error: null,
  };

  const empty = { score: 0, success: false, checks: [] };
  const emptyReadiness = { score: 0, penalties: [] };
  const sandbox = await prepareWorkspace(variant).catch((err) => {
    return { error: String(err) } as const;
  });
  if ("error" in sandbox) {
    return {
      ...base,
      outcome: empty,
      idiom: { findings: [] },
      readiness: emptyReadiness,
      judge: null,
      error: `sandbox: ${sandbox.error}`,
    };
  }

  let trialError: string | undefined;
  let transcript = "";
  try {
    // ── agent phase ──
    if (opts.agentRunner === "golden") {
      await applyGolden(task.dir, sandbox.workspace);
    } else {
      // OAuth tasks get a live IdP for the whole agent session so the agent
      // can inspect/probe the issuer. Grading later starts its own fresh
      // instance on a different port (state isolation + catches hardcoded
      // issuer URLs).
      const agentBackend = task.config.oauth
        ? await startOAuthBackend(task.config.oauth.backend, await freePort())
        : null;
      let info;
      try {
        info = await runClaudeAgent({
          workspace: sandbox.workspace,
          prompt: task.prompt,
          model: opts.model,
          timeoutMs: opts.timeoutMs,
          extraEnv: agentBackend
            ? agentPhaseOAuthEnv(task.config.oauth!, agentBackend.env)
            : undefined,
        });
      } finally {
        await agentBackend?.stop();
      }
      base.durationMs = info.durationMs;
      base.turns = info.turns;
      base.costUsd = info.costUsd;
      transcript = info.transcriptMd;
      await writeFile(join(trialDir, "transcript.jsonl"), info.rawJsonl);
      await writeFile(join(trialDir, "transcript.md"), info.transcriptMd);
      base.transcriptPath = join(
        "trials",
        `${task.config.id}--${vid}--t${opts.trial}`,
        "transcript.md"
      );
    }

    // ── grading phase ──
    const outcome = await gradeOutcome(sandbox.workspace, task.config);
    const idiom = await gradeIdiom(sandbox.workspace, task.config);
    const readiness = gradeReadiness({
      task: task.config,
      variant: vid,
      outcome,
      idiom,
      transcript,
      turns: base.turns,
      costUsd: base.costUsd,
      durationMs: base.durationMs,
    });
    base.sdkVersion = await installedSdkVersion(sandbox.workspace);

    let judge = null;
    if (opts.judgeModel) {
      try {
        judge = await gradeWithJudge({
          task,
          sources: await collectSourceFiles(sandbox.workspace),
          transcript,
          model: opts.judgeModel,
        });
      } catch (err) {
        trialError = `judge failed: ${String(err)}`;
      }
    }

    await snapshotWorkspace(sandbox.workspace, join(trialDir, "workspace"));
    return {
      ...base,
      outcome,
      idiom,
      readiness,
      judge,
      error: trialError ?? null,
    };
  } catch (err) {
    await snapshotWorkspace(
      sandbox.workspace,
      join(trialDir, "workspace")
    ).catch(() => {});
    return {
      ...base,
      outcome: empty,
      idiom: { findings: [] },
      readiness: emptyReadiness,
      judge: null,
      error: String(err instanceof Error ? (err.stack ?? err.message) : err),
    };
  } finally {
    await sandbox.cleanup().catch(() => {});
  }
}

function agentPhaseOAuthEnv(
  oauth: TaskOAuth,
  backendEnv: Record<string, string>
): Record<string, string> {
  if (oauth.backend === "clerk" && oauth.frontendApiUrl) {
    return {
      ...backendEnv,
      MCP_USE_OAUTH_CLERK_FRONTEND_API_URL: oauth.frontendApiUrl,
    };
  }
  return backendEnv;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
