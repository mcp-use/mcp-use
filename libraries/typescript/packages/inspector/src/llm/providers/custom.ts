/**
 * Custom OpenAI-compatible provider.
 *
 * Supports: LM Studio, Ollama, vLLM, LiteLLM, OpenRouter, and any server
 * that speaks the OpenAI Chat Completions API. The user supplies:
 *   - baseUrl  — e.g. "http://localhost:1234" or "https://openrouter.ai/api"
 *   - apiKey   — required for cloud endpoints; leave blank for local servers
 *   - endpoint — override the completions path (default: /v1/chat/completions)
 *   - headers  — extra HTTP headers (e.g. HTTP-Referer for OpenRouter)
 */
import { parseDataUrl } from "../messageFormat";
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

const DEFAULT_BASE_URL = "http://localhost:1234";

/** Builds the full completions URL from baseUrl + optional endpoint override. */
function getEndpoint(config: ProviderConfig): string {
  const base = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  if (config.endpoint) {
    return `${base}${config.endpoint}`;
  }

  // If the base already ends in /v1, just add /chat/completions
  if (base.endsWith("/v1")) {
    return `${base}/chat/completions`;
  }

  return `${base}/v1/chat/completions`;
}

/**
 * Builds request headers.
 * Order of precedence (highest last, so user headers win):
 *   1. Content-Type: application/json
 *   2. Authorization: Bearer <apiKey>   (only when apiKey is provided)
 *   3. config.headers                   (user-supplied, can override anything)
 */
function buildHeaders(config: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey?.trim()) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }
  if (config.headers) {
    Object.assign(headers, config.headers);
  }
  return headers;
}

function toOpenAIContent(content: string | ContentPart[]): unknown {
  if (typeof content === "string") return content;
  return content.map((p) => {
    if (p.type === "text") return { type: "text", text: p.text };
    return { type: "image_url", image_url: { url: p.url } };
  });
}

function toOpenAIMessages(messages: ProviderMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content:
          typeof m.content === "string"
            ? m.content
            : JSON.stringify(m.toolResult ?? m.content),
      });
      continue;
    }
    if (m.role === "assistant") {
      const entry: Record<string, unknown> = {
        role: "assistant",
        content:
          typeof m.content === "string" && m.content.length > 0
            ? m.content
            : null,
      };
      if (m.toolCalls?.length) {
        entry.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }));
      }
      out.push(entry);
      continue;
    }
    out.push({ role: m.role, content: toOpenAIContent(m.content) });
  }
  void parseDataUrl; // silence unused import (shared helper lives here for anthropic)
  return out;
}

/**
 * Streaming chat — wraps the SSE path with a non-streaming fallback.
 * Some local servers (older LM Studio, custom proxies) accept the chat
 * completions format but do not implement SSE streaming. Rather than
 * surfacing an error, we transparently fall back to a single-shot request.
 */
export async function* streamChat(
  params: ChatParams
): AsyncGenerator<LlmStreamEvent, void, unknown> {
  try {
    yield* streamChatSSE(params);
    return;
  } catch {
    // Fallback to non-streaming if SSE throws (e.g. server doesn't support it)
    const res = await chat(params);
    if (res.text) {
      yield { type: "text-delta", delta: res.text };
    }
    for (const tc of res.toolCalls) {
      yield {
        type: "tool-call-start",
        index: 0,
        toolCallId: tc.id,
        toolName: tc.name,
      };
      yield {
        type: "tool-call-ready",
        index: 0,
        toolCallId: tc.id,
        toolName: tc.name,
        args: tc.args,
      };
    }
  }
  yield { type: "done" };
}

async function* streamChatSSE(
  params: ChatParams
): AsyncGenerator<LlmStreamEvent, void, unknown> {
  const { config, messages, tools, signal } = params;
  const body: Record<string, unknown> = {
    model: config.model,
    messages: toOpenAIMessages(messages),
    stream: true,
  };
  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens;
  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  const res = await fetch(getEndpoint(config), {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Custom provider request failed (${res.status} ${res.statusText}): ${text}`
    );
  }

  const buffers = new Map<
    number,
    { id: string; name: string; argsJson: string; started: boolean }
  >();

  for await (const ev of parseSSE(res.body, signal)) {
    if (!ev.data || ev.data === "[DONE]") continue;
    let parsed: any;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      continue;
    }
    const choice = parsed?.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string" && delta.content.length > 0) {
      yield { type: "text-delta", delta: delta.content };
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === "number" ? tc.index : 0;
        let buf = buffers.get(idx);
        if (!buf) {
          buf = {
            id: tc.id ?? `call_${idx}`,
            name: tc.function?.name ?? "",
            argsJson: "",
            started: false,
          };
          buffers.set(idx, buf);
        }
        if (tc.id && !buf.id.startsWith("call_")) buf.id = tc.id;
        else if (tc.id) buf.id = tc.id;
        if (tc.function?.name) buf.name = tc.function.name;
        if (!buf.started && buf.name) {
          buf.started = true;
          yield {
            type: "tool-call-start",
            index: idx,
            toolCallId: buf.id,
            toolName: buf.name,
          };
        }
        const argsChunk: string | undefined = tc.function?.arguments;
        if (typeof argsChunk === "string" && argsChunk.length > 0) {
          buf.argsJson += argsChunk;
          if (buf.started) {
            yield {
              type: "tool-call-args-delta",
              index: idx,
              toolCallId: buf.id,
              toolName: buf.name,
              argsDelta: argsChunk,
            };
          }
        }
      }
    }
    if (choice.finish_reason) {
      for (const [idx, buf] of buffers) {
        let args: Record<string, unknown> = {};
        if (buf.argsJson) {
          try {
            args = JSON.parse(buf.argsJson);
          } catch {
            args = {};
          }
        }
        yield {
          type: "tool-call-ready",
          index: idx,
          toolCallId: buf.id,
          toolName: buf.name,
          args,
        };
      }
      buffers.clear();
    }
  }
  yield { type: "done" };
}

export async function chat(params: ChatParams): Promise<{
  text: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
}> {
  const { config, messages, tools, signal } = params;
  const body: Record<string, unknown> = {
    model: config.model,
    messages: toOpenAIMessages(messages),
  };
  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens;
  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }
  const res = await fetch(getEndpoint(config), {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Custom provider request failed (${res.status} ${res.statusText}): ${text}`
    );
  }
  const json = await res.json();
  const choice = json?.choices?.[0]?.message;
  const text: string =
    typeof choice?.content === "string" ? choice.content : "";
  const toolCalls = Array.isArray(choice?.tool_calls)
    ? choice.tool_calls.map((tc: any) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc?.function?.arguments ?? "{}");
        } catch {
          args = {};
        }
        return {
          id: tc.id,
          name: tc.function?.name ?? "",
          args,
        };
      })
    : [];
  return { text, toolCalls };
}
