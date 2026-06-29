import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MCPSession } from "mcp-use/client";
import {
  captureToolScreenshot,
  detectToolResourceUri,
  extractViewName,
} from "./screenshot.js";
import { parseOpenRouterUsage } from "./judge.js";
import type { TokenUsage } from "./usage.js";

export async function captureWidgetScreenshot(params: {
  session: MCPSession;
  serverBaseUrl: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: unknown;
  resourceUri?: string;
  timeoutMs?: number;
}): Promise<{ pngPath: string; dataUrl: string }> {
  const tools = await params.session.listTools();
  const toolDef = tools.find((t) => t.name === params.toolName);
  const resourceUri =
    params.resourceUri ?? detectToolResourceUri(toolDef) ?? inferResourceUri(params.toolResult);
  if (!resourceUri) {
    throw new Error(`No widget resource URI for tool ${params.toolName}`);
  }

  const view = extractViewName(resourceUri);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mcp-eval-widget-"));
  const pngPath = path.join(tmpDir, `${view}.png`);

  await captureToolScreenshot({
    session: params.session,
    toolName: params.toolName,
    toolArgs: params.toolArgs,
    toolOutput: params.toolResult,
    resourceUri,
  }, {
    inspectorUrl: params.serverBaseUrl,
    theme: "light",
    timeoutMs: params.timeoutMs ?? 60_000,
    output: pngPath,
    delayMs: 500,
  });

  const buf = readFileSync(pngPath);
  const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
  return { pngPath, dataUrl };
}

function inferResourceUri(toolResult: unknown): string | null {
  if (!toolResult || typeof toolResult !== "object") return null;
  const content = (toolResult as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (item && typeof item === "object" && "resource" in item) {
      const uri = (item as { resource?: { uri?: string } }).resource?.uri;
      if (uri) return uri;
    }
  }
  return null;
}

export async function judgeWidgetScreenshot(params: {
  rubric: string;
  screenshotDataUrl: string;
  judgeModel?: string;
  threshold?: number;
}): Promise<{ passed: boolean; score: number; reason: string; usage?: TokenUsage }> {
  const { score, reason, usage } = await runVisionJudge({
    rubric: params.rubric,
    screenshotDataUrl: params.screenshotDataUrl,
    judgeModel: params.judgeModel,
    transcript: "Widget screenshot capture for deterministic visual validation.",
  });
  const threshold = params.threshold ?? 0.7;
  return { passed: score >= threshold, score, reason, usage };
}

async function runVisionJudge(params: {
  rubric: string;
  screenshotDataUrl: string;
  judgeModel?: string;
  transcript: string;
}): Promise<{ score: number; reason: string; usage?: TokenUsage }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { score: 0, reason: "OPENROUTER_API_KEY not set" };
  }
  const model = params.judgeModel ?? "openai/gpt-4o-mini";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an evaluation judge for MCP widget screenshots. Score 0.0-1.0 against the rubric. Return JSON: { score, reason }",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Rubric:\n${params.rubric}\n\nContext:\n${params.transcript}`,
            },
            { type: "image_url", image_url: { url: params.screenshotDataUrl } },
          ],
        },
      ],
      temperature: 0,
    }),
  });
  if (!res.ok) {
    return { score: 0, reason: `Judge API ${res.status}: ${await res.text()}` };
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
  };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const usage = parseOpenRouterUsage(data.usage);
  try {
    const parsed = JSON.parse(content) as { score?: number; reason?: string };
    return {
      score: typeof parsed.score === "number" ? parsed.score : 0,
      reason: typeof parsed.reason === "string" ? parsed.reason : content,
      usage,
    };
  } catch {
    return { score: 0, reason: content, usage };
  }
}

export { runVisionJudge };
