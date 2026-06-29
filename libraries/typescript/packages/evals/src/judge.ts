import type { TokenUsage } from "./usage.js";

const JUDGE_MODEL_DEFAULT = "openai/gpt-4o-mini";

export type JudgeResult = {
  score: number;
  reason: string;
  passed: boolean;
  usage?: TokenUsage;
};

/** Maps an OpenRouter/OpenAI `usage` body into our TokenUsage shape. */
export function parseOpenRouterUsage(usage: unknown): TokenUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
    ...(typeof u.cost === "number" ? { costUsd: u.cost } : {}),
  };
}

export async function runLlmJudge(params: {
  rubric: string;
  threshold: number;
  transcript: string;
  screenshotDataUrl?: string | null;
  judgeModel?: string;
}): Promise<JudgeResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { score: 0, reason: "OPENROUTER_API_KEY not set", passed: false };
  }

  const userContent: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text:
        `Rubric:\n${params.rubric}\n\n---\n\n${params.transcript}\n\n` +
        (params.screenshotDataUrl
          ? "A screenshot is attached — use it for visual/widget claims."
          : "No screenshot — judge from transcript only."),
    },
  ];
  if (params.screenshotDataUrl) {
    userContent.push({ type: "image_url", image_url: { url: params.screenshotDataUrl } });
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.judgeModel ?? JUDGE_MODEL_DEFAULT,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an MCP eval judge. Score 0.0-1.0 against the rubric. Return JSON { score, reason }",
        },
        { role: "user", content: userContent },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { score: 0, reason: `Judge API ${res.status}: ${body.slice(0, 200)}`, passed: false };
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
  };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  let score = 0;
  let reason = "No reason";
  try {
    const parsed = JSON.parse(content) as { score?: number; reason?: string };
    score = typeof parsed.score === "number" ? parsed.score : 0;
    reason = typeof parsed.reason === "string" ? parsed.reason : content;
  } catch {
    reason = content;
  }
  return {
    score,
    reason,
    passed: score >= params.threshold,
    usage: parseOpenRouterUsage(data.usage),
  };
}

export function buildTranscript(
  turns: Array<{ user: string; assistant?: string }>,
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; turnIndex: number }>
): string {
  const lines: string[] = ["=== Transcript ==="];
  for (const t of turns) {
    lines.push(`User: ${t.user}`);
    if (t.assistant) lines.push(`Assistant: ${t.assistant}`);
  }
  lines.push("", "=== Tool calls ===");
  if (toolCalls.length === 0) lines.push("(none)");
  for (const tc of toolCalls) {
    lines.push(
      `Tool: ${tc.tool} (turn ${tc.turnIndex}) args=${JSON.stringify(tc.args)}`
    );
  }
  return lines.join("\n");
}
