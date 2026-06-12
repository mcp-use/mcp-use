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

export interface ExpectedTool {
  name: string;
  /** property names that must appear in the tool's input schema */
  requiredProps?: string[];
}

export interface Expectation {
  type: "contains" | "not-contains" | "number-equals";
  value: string | number;
}

export interface ToolCallCheck {
  tool: string;
  args: Record<string, unknown>;
  expect: Expectation;
}

/**
 * Bearer-auth contract for tasks that require authentication. The grader sets
 * `tokenEnv` to `token` when starting the server, expects unauthenticated and
 * wrong-token requests to be rejected with 401, and runs the tools/calls
 * checks with `token` as the bearer token.
 */
export interface TaskAuth {
  /** env var the server reads the accepted bearer token from */
  tokenEnv: string;
  /** token value the grader sets and authenticates with */
  token: string;
}

export interface TaskConfig {
  id: string;
  title: string;
  /** entry files the grader will try, in order */
  entryCandidates: string[];
  /** when true, the missing-zod-schema idiom detector applies */
  requiresZodSchema: boolean;
  expectedTools: ExpectedTool[];
  calls: ToolCallCheck[];
  /** bearer-auth contract; presence adds the "auth" outcome check */
  auth?: TaskAuth;
  /** variant ids this task supports; omitted = all */
  variants?: string[];
}

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
  sdkSource: string;
  sdkVersion: string | null;
  outcome: OutcomeGrade;
  idiom: IdiomFindings;
  judge: JudgeGrade | null;
  durationMs: number | null;
  turns: number | null;
  costUsd: number | null;
  transcriptPath: string | null;
  timestamp: string;
  error?: string;
}

export interface RunResult {
  runId: string;
  startedAt: string;
  agentRunner: string;
  agentModel: string;
  judgeModel: string;
  trials: TrialResult[];
}
