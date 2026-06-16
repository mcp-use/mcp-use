import { z } from "zod";

export interface Variant {
  /** mcp-builder skill content available to the agent */
  skill: boolean;
  /** workspace pre-scaffolded with create-mcp-use-app (vs truly blank dir) */
  scaffold: boolean;
}

export const ALL_VARIANTS: Variant[] = [
  { skill: false, scaffold: false },
  { skill: false, scaffold: true },
  { skill: true, scaffold: false },
  { skill: true, scaffold: true },
];

export function variantId(v: Variant): string {
  return `${v.skill ? "skill" : "noskill"}+${v.scaffold ? "scaffold" : "blank"}`;
}

export function parseVariant(id: string): Variant {
  const [skill, start] = id.split("+");
  if (
    (skill !== "skill" && skill !== "noskill") ||
    (start !== "scaffold" && start !== "blank")
  ) {
    throw new Error(
      `Invalid variant "${id}" (expected e.g. "skill+scaffold", "noskill+blank")`
    );
  }
  return { skill: skill === "skill", scaffold: start === "scaffold" };
}

const VariantIdSchema = z.string().refine(
  (id) => {
    try {
      parseVariant(id);
      return true;
    } catch {
      return false;
    }
  },
  { error: 'expected a variant id like "skill+scaffold" or "noskill+blank"' }
);

export const ExpectedToolSchema = z.strictObject({
  name: z.string(),
  /** property names that must appear in the tool's input schema */
  requiredProps: z.array(z.string()).optional(),
});
export type ExpectedTool = z.infer<typeof ExpectedToolSchema>;

export const ExpectationSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.enum(["contains", "not-contains"]),
    value: z.string(),
  }),
  z.strictObject({ type: z.literal("number-equals"), value: z.number() }),
]);
export type Expectation = z.infer<typeof ExpectationSchema>;

export const ToolCallCheckSchema = z.strictObject({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  expect: ExpectationSchema,
});
export type ToolCallCheck = z.infer<typeof ToolCallCheckSchema>;

/**
 * OAuth contract for tasks that require authentication. The grader starts a
 * fresh local IdP (an emulate backend, see oauth-backends.ts), injects its
 * env into the server under test, expects the source to use the task's
 * provider-specific SDK OAuth helper, expects unauthenticated and wrong-token
 * requests to be rejected with 401, and runs the tools/calls checks with a
 * token obtained from the IdP via a headless authorization-code flow.
 * The Clerk backend is intentionally a JWT/JWKS-compatible local issuer, not
 * a Dynamic Client Registration emulator.
 */
export const TaskOAuthSchema = z.strictObject({
  /** which emulate-backed IdP the task is graded against */
  backend: z.enum(["clerk", "okta"]),
  /**
   * Optional real Clerk Frontend API URL exposed to the agent phase as
   * MCP_USE_OAUTH_CLERK_FRONTEND_API_URL. Grading still uses the local issuer
   * so the harness can mint deterministic JWTs.
   */
  frontendApiUrl: z.string().url().optional(),
});
export type TaskOAuth = z.infer<typeof TaskOAuthSchema>;

export const ReadinessBudgetsSchema = z.strictObject({
  turns: z.number().positive().optional(),
  costUsd: z.number().positive().optional(),
  durationMs: z.number().positive().optional(),
});
export type ReadinessBudgets = z.infer<typeof ReadinessBudgetsSchema>;

/**
 * Shape of a task's `task.json`, validated at load time so a malformed task
 * fails loudly instead of silently mis-grading (a bad `expect.type` would
 * fall through to number-equals) or vanishing from runs (a misspelled
 * `variants` entry never matches, filtering the task out of every variant).
 */
export const TaskConfigSchema = z.strictObject({
  title: z.string(),
  /** entry files the grader will try, in order */
  entryCandidates: z.array(z.string()).min(1),
  /** when true, the missing-zod-schema idiom detector applies */
  requiresZodSchema: z.boolean(),
  expectedTools: z.array(ExpectedToolSchema),
  calls: z.array(ToolCallCheckSchema),
  /** OAuth contract; presence adds the "auth" outcome check */
  oauth: TaskOAuthSchema.optional(),
  /** expected effort envelope for deterministic readiness scoring */
  readinessBudgets: ReadinessBudgetsSchema.optional(),
  /** variant ids this task supports; omitted = all */
  variants: z.array(VariantIdSchema).optional(),
});

/** Validated task.json plus the task id (its directory name). */
export type TaskConfig = z.infer<typeof TaskConfigSchema> & { id: string };

export interface LoadedTask {
  config: TaskConfig;
  prompt: string;
  promptHash: string;
  dir: string;
}

export interface CheckResult {
  id: string;
  weight: number;
  passed: boolean;
  detail?: string;
}

export type Lever = "docs" | "skill" | "sdk" | "template" | "process";

export interface Finding {
  detector: string;
  file?: string;
  line?: number;
  evidence: string;
  lever: Lever;
}

export interface OutcomeGrade {
  score: number;
  success: boolean;
  checks: CheckResult[];
}

export interface ReadinessPenalty {
  detector: string;
  points: number;
  lever: Lever;
  evidence: string;
  file?: string;
  line?: number;
}

export interface ReadinessGrade {
  score: number;
  penalties: ReadinessPenalty[];
}

/**
 * Output of the friction detectors (graders/idiom.ts). Deliberately NOT a
 * score: detector hits diagnose SDK discoverability (docs/skill/template
 * gaps), they don't measure agent quality. Trends track per-detector hit
 * rates instead of a blended number.
 */
export interface IdiomFindings {
  findings: Finding[];
}

export interface JudgeAssertion {
  id: string;
  verdict: "yes" | "no" | "unknown";
  evidence: string;
}

export interface JudgeGrade {
  score: number;
  assertions: JudgeAssertion[];
  processFindings: Finding[];
  model: string;
}

export interface AgentRunInfo {
  durationMs: number | null;
  turns: number | null;
  costUsd: number | null;
  rawJsonl: string;
  transcriptMd: string;
}

export interface TrialResult {
  task: string;
  variant: string;
  trial: number;
  promptHash: string;
  agentRunner: string;
  agentModel: string;
  sdkVersion: string | null;
  outcome: OutcomeGrade;
  idiom: IdiomFindings;
  readiness: ReadinessGrade;
  judge: JudgeGrade | null;
  durationMs: number | null;
  turns: number | null;
  costUsd: number | null;
  transcriptPath: string | null;
  timestamp: string;
  error: string | null;
}

export interface RunResult {
  runId: string;
  startedAt: string;
  agentRunner: string;
  agentModel: string;
  judgeModel: string;
  trials: TrialResult[];
}

/**
 * Lenient view of a run.json for the cross-run trends script: only the fields
 * trends actually reads, with unknown keys passed through. Deliberately NOT
 * the strict RunResult shape — trends is longitudinal, so historical run.json
 * files must keep parsing as the format evolves; a file that fails even this
 * is corrupt and gets skipped with a warning instead of crashing the table.
 */
export const TrendRunSchema = z.looseObject({
  startedAt: z.string(),
  trials: z.array(
    z.looseObject({
      task: z.string(),
      variant: z.string(),
      outcome: z.looseObject({ success: z.boolean() }),
      readiness: z
        .looseObject({
          score: z.number(),
          penalties: z.array(z.looseObject({ detector: z.string() })),
        })
        .optional(),
    })
  ),
});
export type TrendRun = z.infer<typeof TrendRunSchema>;
