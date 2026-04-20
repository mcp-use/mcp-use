import { extractSystem, parseDataUrl } from "../messageFormat";
import { sanitizeSchemaForGemini } from "../schemaUtils";
import { parseSSE } from "../sse";
import type {
  ContentPart,
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderTool,
} from "../types";

interface ChatParams {
  config: ProviderConfig;
  messages: ProviderMessage[];
  tools?: ProviderTool[];
  signal?: AbortSignal;
}

/**
 * Normalize a Gemini model identifier. The Google list-models API returns
 * `name: "models/<id>"` and the UI sometimes persists that full resource
 * name; users may also paste a bare id like `gemini-2.5-flash`. Both forms
 * must resolve to the same `models/<id>` URL segment.
 */
function normalizeModelId(model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith("models/")
    ? trimmed.slice("models/".length)
    : trimmed;
}

function endpointFor(model: string, mode: "stream" | "single"): string {
  const action =
    mode === "stream" ? "streamGenerateContent?alt=sse" : "generateContent";
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    normalizeModelId(model)
  )}:${action}`;
}

function buildInlineData(p: ContentPart): unknown {
  if (p.type !== "image") return null;
  if (p.data && p.mimeType) {
    return { inlineData: { mimeType: p.mimeType, data: p.data } };
  }
  const parsed = parseDataUrl(p.url);
  if (parsed) {
    return {
      inlineData: { mimeType: parsed.mimeType, data: parsed.data },
    };
  }
  return null;
}

function toGeminiParts(content: string | ContentPart[]): unknown[] {
  if (typeof content === "string") {
    return [{ text: content || "[no content]" }];
  }
  const parts: unknown[] = [];
  for (const p of content) {
    if (p.type === "text") {
      if (p.text) parts.push({ text: p.text });
    } else {
      const block = buildInlineData(p);
      if (block) parts.push(block);
    }
  }
  if (parts.length === 0) parts.push({ text: "[no content]" });
  return parts;
}

function toGeminiContents(messages: ProviderMessage[]): unknown[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      let response: unknown;
      try {
        response =
          typeof m.content === "string" ? JSON.parse(m.content) : m.toolResult;
      } catch {
        response = {
          result: typeof m.content === "string" ? m.content : m.toolResult,
        };
      }
      if (!response || typeof response !== "object") {
        response = { result: response };
      }
      const last = out[out.length - 1];
      const part = {
        functionResponse: {
          name: m.toolName,
          response,
        },
      };
      if (last && last.role === "function") {
        last.parts.push(part);
      } else {
        out.push({ role: "function", parts: [part] });
      }
      continue;
    }
    if (m.role === "assistant") {
      const parts: any[] = [];
      const textContent =
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map((p) => (p.type === "text" ? p.text : "")).join("")
            : "";
      if (textContent) parts.push({ text: textContent });
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          parts.push({
            functionCall: { name: tc.name, args: tc.args ?? {} },
          });
        }
      }
      if (parts.length === 0) parts.push({ text: "[no content]" });
      out.push({ role: "model", parts });
      continue;
    }
    out.push({ role: "user", parts: toGeminiParts(m.content) });
  }
  return out;
}

function buildBody(params: ChatParams) {
  const { config, messages, tools } = params;
  const { system, rest } = extractSystem(messages);
  const body: Record<string, unknown> = {
    contents: toGeminiContents(rest),
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  const genConfig: Record<string, unknown> = {};
  if (config.temperature !== undefined)
    genConfig.temperature = config.temperature;
  if (config.maxTokens !== undefined)
    genConfig.maxOutputTokens = config.maxTokens;
  if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig;
  if (tools && tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: sanitizeSchemaForGemini(t.inputSchema),
        })),
      },
    ];
  }
  return body;
}

export async function* streamChat(
  params: ChatParams
): AsyncGenerator<LlmStreamEvent, void, unknown> {
  const { config, signal } = params;
  const url = `${endpointFor(config.model, "stream")}&key=${encodeURIComponent(
    config.apiKey
  )}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBody(params)),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google request failed (${res.status} ${res.statusText}): ${text}`
    );
  }

  let toolCallCounter = 0;

  for await (const ev of parseSSE(res.body, signal)) {
    let parsed: any;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      continue;
    }
    const parts = parsed?.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      if (typeof p.text === "string" && p.text.length > 0) {
        yield { type: "text-delta", delta: p.text };
      } else if (p.functionCall && typeof p.functionCall === "object") {
        const idx = toolCallCounter++;
        const id = `call_${idx}_${p.functionCall.name ?? "tool"}`;
        const name: string = p.functionCall.name ?? "";
        const args =
          p.functionCall.args && typeof p.functionCall.args === "object"
            ? (p.functionCall.args as Record<string, unknown>)
            : {};
        yield {
          type: "tool-call-start",
          index: idx,
          toolCallId: id,
          toolName: name,
        };
        // Gemini delivers args as a whole object — emit the full JSON at
        // once so downstream code can still render args progressively.
        const argsJson = JSON.stringify(args);
        if (argsJson && argsJson !== "{}") {
          yield {
            type: "tool-call-args-delta",
            index: idx,
            toolCallId: id,
            toolName: name,
            argsDelta: argsJson,
          };
        }
        yield {
          type: "tool-call-ready",
          index: idx,
          toolCallId: id,
          toolName: name,
          args,
        };
      }
    }
  }
  yield { type: "done" };
}

export async function chat(params: ChatParams): Promise<{
  text: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
}> {
  const { config, signal } = params;
  const url = `${endpointFor(config.model, "single")}?key=${encodeURIComponent(
    config.apiKey
  )}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBody(params)),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google request failed (${res.status} ${res.statusText}): ${text}`
    );
  }
  const json = await res.json();
  let text = "";
  const toolCalls: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  }[] = [];
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    if (typeof p.text === "string") text += p.text;
    else if (p.functionCall) {
      toolCalls.push({
        id: `call_${toolCalls.length}_${p.functionCall.name ?? "tool"}`,
        name: p.functionCall.name ?? "",
        args:
          p.functionCall.args && typeof p.functionCall.args === "object"
            ? (p.functionCall.args as Record<string, unknown>)
            : {},
      });
    }
  }
  return { text, toolCalls };
}
