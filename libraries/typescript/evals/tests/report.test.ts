import { describe, expect, it } from "vitest";
import {
  collectJudgeNotes,
  collectReadinessPenalties,
  renderReport,
} from "../src/report.js";
import type { RunResult, TrialResult } from "../src/types.js";

function trial(overrides: Partial<TrialResult>): TrialResult {
  return {
    task: "01-basic-tool-server",
    variant: "noskill+blank",
    trial: 1,
    promptHash: "abc123",
    agentRunner: "claude",
    agentModel: "default",
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
    readiness: { score: 100, penalties: [] },
    judge: null,
    durationMs: 60000,
    turns: 10,
    costUsd: 0.42,
    transcriptPath: "trials/x/transcript.md",
    timestamp: "2026-06-11T00:00:00Z",
    error: null,
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
  readiness: {
    score: 92,
    penalties: [
      {
        detector: "hand-rolled-content-block",
        points: 8,
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

  it("includes a summary row per task×variant with readiness and penalty counts", () => {
    expect(report).toContain(
      "| 01-basic-tool-server | noskill+blank | 1/1 ✅ | 100 | 100 | 0/1 trials | $0.42 | 10 |"
    );
    expect(report).toContain(
      "| 01-basic-tool-server | skill+scaffold | 0/1 ❌ | 40 | 92 | 1/1 trials | $0.42 | 10 |"
    );
  });

  it("lists readiness penalty names per trial in the detail table", () => {
    expect(report).toMatch(
      /\| skill\+scaffold \| 1 \|.*\| 92 \| `hand-rolled-content-block` \|/
    );
  });

  it("renders the variant matrix with deltas when multiple variants ran", () => {
    expect(report).toContain("## Variant matrix");
    expect(report).toContain("| no skill | 1/1 |");
    expect(report).toContain("Skill uplift: -100pp");
    expect(report).toContain("Skill readiness uplift: -8");
  });

  it("aggregates deterministic readiness penalties with counts and lever", () => {
    expect(report).toContain("## Top Readiness Penalties");
    expect(report).toContain("`hand-rolled-content-block`");
    expect(report).toContain("8 pts");
    expect(report).toContain("lever: skill");
  });

  it("includes per-check failure details", () => {
    expect(report).toContain('tool "add" not listed');
  });
  it("renders judge findings as advisory notes outside readiness penalties", () => {
    const withJudge = renderReport({
      ...RUN,
      trials: [
        trial({
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
        }),
      ],
    });
    expect(withJudge).toContain("## Judge Notes");
    expect(withJudge).toContain("`judge:struggled`");
    expect(withJudge).toContain(
      "None detected — no deterministic readiness penalties fired."
    );
  });
});

describe("collectReadinessPenalties", () => {
  it("counts trials, not raw hits, sorts by frequency, and excludes judge notes", () => {
    const t1 = trial({
      readiness: {
        score: 75,
        penalties: [
          {
            detector: "raw-sdk-import",
            points: 25,
            file: "a.ts",
            line: 1,
            evidence: "x",
            lever: "docs",
          },
          {
            detector: "raw-sdk-import",
            points: 25,
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
      readiness: {
        score: 75,
        penalties: [
          {
            detector: "raw-sdk-import",
            points: 25,
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
    const penalties = collectReadinessPenalties([t1, t2]);
    expect(penalties[0]).toMatchObject({
      detector: "raw-sdk-import",
      count: 2,
    });
    expect(
      penalties.find((p) => p.detector === "judge:struggled")
    ).toBeUndefined();
    expect(collectJudgeNotes([t1, t2])).toMatchObject([
      { detector: "judge:struggled", count: 1 },
    ]);
  });
});
