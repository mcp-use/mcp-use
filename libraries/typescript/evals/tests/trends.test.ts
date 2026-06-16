import { describe, expect, it } from "vitest";
import { TrendRunSchema } from "../src/types.js";

function currentFormatRun(): Record<string, unknown> {
  return {
    runId: "01-basic-tool-server--noskill+blank--2026-06-12T00-00-00",
    startedAt: "2026-06-12T00:00:00.000Z",
    agentRunner: "claude",
    agentModel: "default",
    judgeModel: "claude-opus-4-8",
    trials: [
      {
        task: "01-basic-tool-server",
        variant: "noskill+blank",
        trial: 1,
        promptHash: "abc123",
        agentRunner: "claude",
        agentModel: "default",
        sdkVersion: "1.2.3",
        outcome: { score: 100, success: true, checks: [] },
        readiness: {
          score: 90,
          penalties: [{ detector: "package-export-confusing" }],
        },
        idiom: { findings: [{ detector: "raw-sdk-import", lever: "docs" }] },
        judge: {
          score: 80,
          assertions: [],
          processFindings: [{ detector: "judge:struggled" }],
          model: "m",
        },
        durationMs: 1,
        turns: 1,
        costUsd: 0.1,
        transcriptPath: null,
        timestamp: "2026-06-12T00:00:00Z",
        error: null,
      },
    ],
  };
}

describe("TrendRunSchema", () => {
  it("accepts a current-format run.json", () => {
    expect(TrendRunSchema.safeParse(currentFormatRun()).success).toBe(true);
  });

  it("accepts historical run.json shapes (extra fields, fields since removed/added)", () => {
    const run = currentFormatRun();
    const trial = (run.trials as Record<string, unknown>[])[0];
    trial.sdkSource = "npm"; // field removed from TrialResult
    delete trial.readiness; // field that older runs never wrote
    delete trial.error; // field that older runs never wrote
    trial.judge = null; // judge skipped
    trial.someFutureField = { anything: true };
    expect(TrendRunSchema.safeParse(run).success).toBe(true);
  });

  it("rejects a file that is not a run result", () => {
    expect(TrendRunSchema.safeParse({ hello: "world" }).success).toBe(false);
    expect(TrendRunSchema.safeParse(undefined).success).toBe(false);
    expect(TrendRunSchema.safeParse([1, 2, 3]).success).toBe(false);
  });

  it("rejects trials missing the fields trends reads", () => {
    const run = currentFormatRun();
    delete (run.trials as Record<string, unknown>[])[0].outcome;
    expect(TrendRunSchema.safeParse(run).success).toBe(false);
  });
});
