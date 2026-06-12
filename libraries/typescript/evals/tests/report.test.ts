import { describe, expect, it } from "vitest";
import { collectFrictions, renderReport } from "../src/report.js";
import type { RunResult, TrialResult } from "../src/types.js";

function trial(overrides: Partial<TrialResult>): TrialResult {
  return {
    task: "01-basic-tool-server",
    variant: "noskill+blank",
    trial: 1,
    promptHash: "abc123",
    agentRunner: "claude",
    agentModel: "default",
    sdkSource: "npm",
    sdkVersion: "1.2.3",
    outcome: {
      score: 100,
      success: true,
      checks: [
        { id: "compiles", weight: 20, passed: true },
        { id: "starts", weight: 20, passed: true },
        { id: "tools", weight: 30, passed: true },
        { id: "calls", weight: 30, passed: true },
      ],
    },
    idiom: { findings: [] },
    judge: null,
    durationMs: 60000,
    turns: 10,
    costUsd: 0.42,
    transcriptPath: "trials/x/transcript.md",
    timestamp: "2026-06-11T00:00:00Z",
    ...overrides,
  };
}

const FAILED = trial({
  variant: "skill+scaffold",
  outcome: {
    score: 40,
    success: false,
    checks: [
      { id: "compiles", weight: 20, passed: true },
      { id: "starts", weight: 20, passed: true },
      {
        id: "tools",
        weight: 30,
        passed: false,
        detail: 'tool "add" not listed',
      },
      { id: "calls", weight: 30, passed: false, detail: "server not running" },
    ],
  },
  idiom: {
    findings: [
      {
        detector: "hand-rolled-content-block",
        file: "index.ts",
        line: 4,
        evidence: "content: [{",
        lever: "skill",
      },
    ],
  },
});

const RUN: RunResult = {
  runId: "2026-06-11T00-00-00",
  startedAt: "2026-06-11T00:00:00.000Z",
  agentRunner: "claude",
  agentModel: "default",
  judgeModel: "claude-opus-4-8",
  trials: [trial({}), FAILED],
};

describe("renderReport", () => {
  const report = renderReport(RUN);

  it("includes a summary row per task×variant with success and friction counts", () => {
    expect(report).toContain(
      "| 01-basic-tool-server | noskill+blank | 1/1 ✅ | 100 | 0/1 trials |"
    );
    expect(report).toContain(
      "| 01-basic-tool-server | skill+scaffold | 0/1 ❌ | 40 | 1/1 trials |"
    );
  });

  it("lists detector names per trial in the detail table", () => {
    expect(report).toMatch(
      /\| skill\+scaffold \| 1 \|.*\| `hand-rolled-content-block` \|/
    );
  });

  it("renders the variant matrix with deltas when multiple variants ran", () => {
    expect(report).toContain("## Variant matrix");
    expect(report).toContain("| no skill | 1/1 |");
    expect(report).toContain("Skill uplift: -100pp");
  });

  it("aggregates friction points with counts and lever", () => {
    expect(report).toContain("`hand-rolled-content-block`");
    expect(report).toContain("lever: skill");
  });

  it("includes per-check failure details", () => {
    expect(report).toContain('tool "add" not listed');
  });
});

describe("collectFrictions", () => {
  it("counts trials, not raw hits, and sorts by frequency", () => {
    const t1 = trial({
      idiom: {
        findings: [
          {
            detector: "raw-sdk-import",
            file: "a.ts",
            line: 1,
            evidence: "x",
            lever: "docs",
          },
          {
            detector: "raw-sdk-import",
            file: "b.ts",
            line: 1,
            evidence: "y",
            lever: "docs",
          },
        ],
      },
    });
    const t2 = trial({
      trial: 2,
      idiom: {
        findings: [
          {
            detector: "raw-sdk-import",
            file: "c.ts",
            line: 9,
            evidence: "z",
            lever: "docs",
          },
        ],
      },
      judge: {
        score: 80,
        model: "m",
        assertions: [],
        processFindings: [
          {
            detector: "judge:struggled",
            evidence: "retried 4 times",
            lever: "process",
          },
        ],
      },
    });
    const frictions = collectFrictions([t1, t2]);
    expect(frictions[0]).toMatchObject({
      detector: "raw-sdk-import",
      count: 2,
    });
    expect(frictions.find((f) => f.detector === "judge:struggled")?.count).toBe(
      1
    );
  });
});
