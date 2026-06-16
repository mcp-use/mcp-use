import { describe, expect, it } from "vitest";
import { gradeReadiness } from "../src/graders/readiness.js";
import type { IdiomFindings, OutcomeGrade, TaskConfig } from "../src/types.js";

const TASK: TaskConfig = {
  id: "01-basic-tool-server",
  title: "Basic tool server",
  entryCandidates: ["src/server.ts"],
  requiresZodSchema: true,
  expectedTools: [{ name: "add", requiredProps: ["a", "b"] }],
  calls: [
    {
      tool: "add",
      args: { a: 2, b: 3 },
      expect: { type: "number-equals", value: 5 },
    },
  ],
};

const OUTCOME: OutcomeGrade = {
  score: 100,
  success: true,
  checks: [],
};

const CLEAN_IDIOM: IdiomFindings = { findings: [] };

function grade(overrides: {
  task?: TaskConfig;
  variant?: string;
  outcome?: OutcomeGrade;
  idiom?: IdiomFindings;
  transcript?: string;
  turns?: number | null;
  costUsd?: number | null;
  durationMs?: number | null;
}) {
  return gradeReadiness({
    task: overrides.task ?? TASK,
    variant: overrides.variant ?? "noskill+blank",
    outcome: overrides.outcome ?? OUTCOME,
    idiom: overrides.idiom ?? CLEAN_IDIOM,
    transcript: overrides.transcript ?? "npx tsc --noEmit passed",
    turns: overrides.turns ?? 5,
    costUsd: overrides.costUsd ?? 0.1,
    durationMs: overrides.durationMs ?? 1000,
  });
}

describe("gradeReadiness", () => {
  it("does not penalize brief type inspection without public-path failure", () => {
    const result = grade({
      transcript:
        "I briefly checked index.d.ts to confirm a handler signature, then ran npx tsc --noEmit successfully.",
    });
    expect(result.penalties).toEqual([]);
    expect(result.score).toBe(100);
  });

  it("flags package export confusion during SDK discovery", () => {
    const result = grade({
      transcript:
        "node -e require('mcp-use/package.json') failed with ERR_PACKAGE_PATH_NOT_EXPORTED. I then ran npx tsc --noEmit successfully.",
    });
    expect(result.penalties.map((p) => p.detector)).toContain(
      "package-export-confusing"
    );
  });

  it("flags deep type spelunking through generated declarations", () => {
    const result = grade({
      transcript:
        "I had to grep node_modules/mcp-use/dist/src/server/mcp-server.d.ts for MCPServer, server.tool, and text(). Output too large, 42.6KB. npx tsc --noEmit passed.",
    });
    expect(result.penalties.map((p) => p.detector)).toContain(
      "deep-type-spelunking"
    );
  });

  it("flags multiple failed typecheck attempts", () => {
    const result = grade({
      transcript:
        "[tool] Bash(npx tsc --noEmit)\n[result ERROR] error TS2345: bad\n[tool] Bash(npx tsc --noEmit)\n[result ERROR] error TS2339: bad\n[tool] Bash(npx tsc --noEmit)\n[result] ok",
    });
    expect(result.penalties.map((p) => p.detector)).toContain(
      "compile-repair-loop"
    );
  });

  it("flags missing self-verification when transcript has no verification evidence", () => {
    const result = grade({ transcript: "I am done." });
    expect(result.penalties.map((p) => p.detector)).toContain(
      "no-self-verification"
    );
  });

  it("subtracts one budget penalty per exceeded effort dimension", () => {
    const result = grade({
      transcript: "npx tsc --noEmit passed",
      turns: 21,
      costUsd: 0.8,
      durationMs: 151_000,
    });
    expect(result.penalties.map((p) => p.detector)).toEqual([
      "budget-overrun",
      "budget-overrun:cost",
      "budget-overrun:duration",
    ]);
    expect(result.score).toBe(85);
  });

  it("caps readiness at outcome score when the contract failed", () => {
    const result = grade({
      transcript: "",
      outcome: { score: 40, success: false, checks: [] },
    });
    expect(result.score).toBe(40);
  });
});
