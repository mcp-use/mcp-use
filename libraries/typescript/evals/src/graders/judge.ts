import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Finding, JudgeGrade, LoadedTask } from "../types.js";

export const DEFAULT_JUDGE_MODEL = "claude-opus-4-8";

/**
 * Binary assertions, not 0-5 sliders: yes/no/unknown verdicts are far more
 * reproducible run-to-run, which is what a longitudinal metric needs.
 * "unknown" is the escape hatch — excluded from the score's denominator.
 */
const ASSERTIONS: Array<{ id: string; question: string }> = [
  {
    id: "imports-from-mcp-use",
    question:
      "Does the code import the server API from 'mcp-use/server' (or 'mcp-use') rather than hand-rolling protocol handling?",
  },
  {
    id: "uses-zod-schema",
    question:
      "Are tool input schemas defined with zod and passed to the tool definition?",
  },
  {
    id: "uses-response-helpers",
    question:
      "Do tool handlers return via mcp-use response helpers (text(), object(), …) rather than hand-built content arrays?",
  },
  {
    id: "no-hallucinated-api",
    question:
      "Is the code free of invented/nonexistent mcp-use APIs (methods, options, imports that don't exist)?",
  },
  {
    id: "error-handling-reasonable",
    question:
      "Is error handling reasonable for the task (invalid input doesn't crash the server; no pointless defensive boilerplate either)?",
  },
  {
    id: "tool-descriptions-clear",
    question:
      "Do tools have clear names and descriptions an LLM client could act on?",
  },
  {
    id: "self-verified",
    question:
      "Per the transcript, did the agent verify its own work before finishing (typecheck/build, start the server, or exercise a tool)?",
  },
];

const JudgeOutput = z.object({
  assertions: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(["yes", "no", "unknown"]),
      evidence: z.string(),
    })
  ),
  processFindings: z.array(
    z.object({
      category: z.enum([
        "struggled",
        "hallucinated-api",
        "no-self-verification",
        "fought-template",
        "other",
      ]),
      evidence: z.string(),
      suggestion: z.string(),
    })
  ),
});

const SYSTEM = `You are grading how well a coding agent used the mcp-use TypeScript SDK to build an MCP server. You receive the task prompt, the produced source files, and a condensed transcript of the agent's session.

Answer each assertion with a binary verdict:
- "yes" / "no" only when the provided code or transcript contains direct evidence — quote it in the evidence field.
- "unknown" when you cannot tell from what's provided. Never guess.

Also extract process findings from the transcript — places the agent struggled, retried, hallucinated APIs or CLI flags, fought a scaffold template, or skipped verifying its own work. For each, give concrete evidence and a suggestion for what the mcp-use team should improve (docs, skill content, SDK API/error messages, or template). Report only findings with transcript/code evidence; an empty list is a valid answer.`;

const MAX_SOURCE_CHARS = 40_000;
const MAX_TRANSCRIPT_CHARS = 30_000;

export async function gradeWithJudge(opts: {
  task: LoadedTask;
  sources: Map<string, string>;
  transcript: string;
  model?: string;
}): Promise<JudgeGrade> {
  const model = opts.model ?? DEFAULT_JUDGE_MODEL;
  const client = new Anthropic();

  const sourcesText = truncateMiddle(
    [...opts.sources.entries()]
      .map(([file, content]) => `### ${file}\n\`\`\`ts\n${content}\n\`\`\``)
      .join("\n\n"),
    MAX_SOURCE_CHARS
  );
  const transcriptText = truncateMiddle(
    opts.transcript || "(no transcript — golden/manual run)",
    MAX_TRANSCRIPT_CHARS
  );

  const userMessage = [
    `## Task prompt given to the agent\n${opts.task.prompt}`,
    `## Produced source files\n${sourcesText || "(no source files found)"}`,
    `## Agent transcript (condensed)\n${transcriptText}`,
    `## Assertions to grade\n${ASSERTIONS.map((a) => `- ${a.id}: ${a.question}`).join("\n")}`,
  ].join("\n\n");

  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    output_config: { format: zodOutputFormat(JudgeOutput) },
    messages: [{ role: "user", content: userMessage }],
  });

  const parsed = response.parsed_output;
  if (!parsed)
    throw new Error("judge response did not match the output schema");

  // only grade known assertion ids; tolerate the judge omitting one (counts as unknown)
  const knownIds = new Set(ASSERTIONS.map((a) => a.id));
  const assertions = parsed.assertions.filter((a) => knownIds.has(a.id));
  const yes = assertions.filter((a) => a.verdict === "yes").length;
  const no = assertions.filter((a) => a.verdict === "no").length;
  const score = yes + no === 0 ? 0 : Math.round((yes / (yes + no)) * 100);

  const processFindings: Finding[] = parsed.processFindings.map((f) => ({
    detector: `judge:${f.category}`,
    evidence: f.evidence,
    lever:
      f.category === "hallucinated-api"
        ? "sdk"
        : f.category === "fought-template"
          ? "template"
          : "process",
  }));

  return { score, assertions, processFindings, model };
}

function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const half = Math.floor(max / 2);
  return `${s.slice(0, half)}\n\n…[truncated ${s.length - max} chars]…\n\n${s.slice(-half)}`;
}
