import type {
  IdiomFindings,
  OutcomeGrade,
  ReadinessBudgets,
  ReadinessGrade,
  ReadinessPenalty,
  TaskConfig,
} from "../types.js";

const DEFAULT_BUDGETS: Required<ReadinessBudgets> = {
  turns: 30,
  costUsd: 1.5,
  durationMs: 300_000,
};

const TASK_DEFAULT_BUDGETS: Record<string, Required<ReadinessBudgets>> = {
  "01-basic-tool-server": {
    turns: 20,
    costUsd: 0.75,
    durationMs: 150_000,
  },
  "02-stateful-notes-server": {
    turns: 25,
    costUsd: 0.95,
    durationMs: 210_000,
  },
  "03-oauth-clerk": {
    turns: 40,
    costUsd: 2.25,
    durationMs: 360_000,
  },
  "04-oauth-custom-idp": {
    turns: 40,
    costUsd: 2.25,
    durationMs: 360_000,
  },
  "05-job-board-context": {
    turns: 30,
    costUsd: 1.15,
    durationMs: 240_000,
  },
};

const IDIOM_POINTS: Record<string, number> = {
  "raw-sdk-import": 25,
  "hand-rolled-auth": 20,
  "wrong-oauth-provider": 15,
  "direct-window-openai": 12,
  "create-mcp-server-factory": 10,
  "hand-rolled-jwks-verify": 10,
  "missing-zod-schema": 10,
  "hand-rolled-content-block": 8,
  "no-response-helper-import": 8,
};

export function readinessBudgets(
  task: TaskConfig
): Required<ReadinessBudgets> {
  return {
    ...(TASK_DEFAULT_BUDGETS[task.id] ?? DEFAULT_BUDGETS),
    ...task.readinessBudgets,
  };
}

export function gradeReadiness(opts: {
  task: TaskConfig;
  variant: string;
  outcome: OutcomeGrade;
  idiom: IdiomFindings;
  transcript: string;
  turns: number | null;
  costUsd: number | null;
  durationMs: number | null;
}): ReadinessGrade {
  const penalties: ReadinessPenalty[] = [];
  const seen = new Set<string>();

  for (const finding of opts.idiom.findings) {
    const points = IDIOM_POINTS[finding.detector];
    if (!points || seen.has(finding.detector)) continue;
    seen.add(finding.detector);
    penalties.push({
      detector: finding.detector,
      points,
      lever: finding.lever,
      evidence: finding.evidence,
      file: finding.file,
      line: finding.line,
    });
  }

  for (const penalty of processPenalties(opts)) {
    if (seen.has(penalty.detector)) continue;
    seen.add(penalty.detector);
    penalties.push(penalty);
  }

  const raw = Math.max(
    0,
    100 - penalties.reduce((sum, p) => sum + p.points, 0)
  );
  const score = opts.outcome.success ? raw : Math.min(raw, opts.outcome.score);
  return { score, penalties };
}

function processPenalties(opts: {
  task: TaskConfig;
  variant: string;
  transcript: string;
  turns: number | null;
  costUsd: number | null;
  durationMs: number | null;
}): ReadinessPenalty[] {
  const penalties: ReadinessPenalty[] = [];
  const transcript = opts.transcript.trim();
  const lower = transcript.toLowerCase();

  if (transcript) {
    if (packageExportConfusing(transcript)) {
      penalties.push({
        detector: "package-export-confusing",
        points: 10,
        lever: "sdk",
        evidence:
          "package export probing failed while the agent was trying to discover SDK usage",
      });
    }

    if (publicApiNotObvious(transcript)) {
      penalties.push({
        detector: "public-api-not-obvious",
        points: 15,
        lever: "docs",
        evidence:
          "agent inspected installed internals before finding a core mcp-use server API",
      });
    }

    if (deepTypeSpelunking(transcript)) {
      penalties.push({
        detector: "deep-type-spelunking",
        points: 10,
        lever: "docs",
        evidence:
          "agent grepped/read large generated declaration or dist files to learn basic SDK usage",
      });
    }

    if (docsSkillMiss(opts.variant, transcript)) {
      penalties.push({
        detector: "docs-skill-miss",
        points: 12,
        lever: opts.variant.startsWith("skill+") ? "skill" : "docs",
        evidence:
          "skill/scaffold/docs were present but did not expose the golden path clearly enough",
      });
    }

    if (inventedApiRepair(transcript)) {
      penalties.push({
        detector: "invented-api-repair",
        points: 15,
        lever: "sdk",
        evidence:
          "agent attempted a nonexistent mcp-use API and repaired after compiler/runtime feedback",
      });
    }

    if (compileRepairLoop(transcript)) {
      penalties.push({
        detector: "compile-repair-loop",
        points: 10,
        lever: "process",
        evidence: "multiple failed typecheck/build attempts occurred before success",
      });
    }

    if (verificationDetour(opts.task, transcript)) {
      penalties.push({
        detector: "verification-detour",
        points: 8,
        lever: "process",
        evidence:
          "agent hand-drove MCP/OAuth verification instead of using the canonical client path",
      });
    }

    if (!selfVerified(lower)) {
      penalties.push({
        detector: "no-self-verification",
        points: 12,
        lever: "process",
        evidence:
          "transcript contains no typecheck, server start, MCP client, or tool-call verification before finishing",
      });
    }

    if (scaffoldConfusion(opts.variant, transcript)) {
      penalties.push({
        detector: "scaffold-confusion",
        points: 10,
        lever: "template",
        evidence:
          "agent removed or fought scaffold code because the starter shape obscured the task path",
      });
    }
  }

  const budgets = readinessBudgets(opts.task);
  if (opts.turns !== null && opts.turns > budgets.turns) {
    penalties.push({
      detector: "budget-overrun",
      points: 5,
      lever: "process",
      evidence: `turns ${opts.turns} exceeded budget ${budgets.turns}`,
    });
  }
  if (opts.costUsd !== null && opts.costUsd > budgets.costUsd) {
    penalties.push({
      detector: "budget-overrun:cost",
      points: 5,
      lever: "process",
      evidence: `cost $${opts.costUsd.toFixed(2)} exceeded budget $${budgets.costUsd.toFixed(2)}`,
    });
  }
  if (opts.durationMs !== null && opts.durationMs > budgets.durationMs) {
    penalties.push({
      detector: "budget-overrun:duration",
      points: 5,
      lever: "process",
      evidence: `duration ${opts.durationMs}ms exceeded budget ${budgets.durationMs}ms`,
    });
  }

  return penalties;
}

function packageExportConfusing(transcript: string): boolean {
  return /ERR_PACKAGE_PATH_NOT_EXPORTED|Package subpath .*not defined by "exports"|not exported by package|No "exports" main defined/i.test(
    transcript
  );
}

function publicApiNotObvious(transcript: string): boolean {
  return (
    /(node_modules\/mcp-use|dist\/src|dist\/|\.d\.ts|declaration file)/i.test(
      transcript
    ) &&
    /(MCPServer|createMCPServer|server\.tool|response helper|text\(\)|object\(\)|mcp-use\/server)/i.test(
      transcript
    ) &&
    /(grep|rg|sed|cat|inspect|looked? through|search)/i.test(transcript)
  );
}

function deepTypeSpelunking(transcript: string): boolean {
  return (
    /(grep|rg|sed|cat).*(dist\/src|node_modules\/mcp-use|\.d\.ts)/is.test(
      transcript
    ) &&
    /(Output too large|declaration file|\.d\.ts|[1-9]\d(?:\.\d+)?KB|large)/i.test(
      transcript
    )
  );
}

function docsSkillMiss(variant: string, transcript: string): boolean {
  if (!variant.startsWith("skill+") && !variant.endsWith("+scaffold"))
    return false;
  return /(skill explicitly documents|despite the skill|docs say|documented.*canonical|couldn't find.*docs|could not find.*docs|skill.*did not)/i.test(
    transcript
  );
}

function inventedApiRepair(transcript: string): boolean {
  return (
    /(createMCPServer|MCPServer|oauth|server\.tool|mcp-use)/i.test(transcript) &&
    /(not assignable to parameter|has no exported member|Property .* does not exist|is not a function|Cannot find name|does not exist on type|TS23\d\d|TS25\d\d)/i.test(
      transcript
    )
  );
}

function compileRepairLoop(transcript: string): boolean {
  const failedChecks = transcript.match(
    /(tsc --noEmit|npm run build|pnpm build|typecheck)[\s\S]{0,700}(\[result ERROR\]|error TS|failed)/gi
  );
  if ((failedChecks?.length ?? 0) >= 2) return true;
  const typeErrors = transcript.match(/error TS\d+:/g);
  return (typeErrors?.length ?? 0) >= 2;
}

function verificationDetour(task: TaskConfig, transcript: string): boolean {
  if (!task.oauth) return false;
  return /(consent POST|get code|authorization-code|authorization code|custom node.*initialize|raw curl|manually.*oauth|manual.*oauth)/i.test(
    transcript
  );
}

function selfVerified(lowerTranscript: string): boolean {
  return /(tsc|typecheck|npm run build|pnpm build|npm test|pnpm test|mcp-use client|listtools|calltool|call tool|server started|list tools|curl .*\/mcp|tsx .*server)/i.test(
    lowerTranscript
  );
}

function scaffoldConfusion(variant: string, transcript: string): boolean {
  if (!variant.endsWith("+scaffold")) return false;
  return /(rm -f index\.ts|removed? .*index\.ts|delete[d]? .*template|old index\.ts|weather demo|fought .*template|scaffold.*wrong|starter.*wrong)/i.test(
    transcript
  );
}
