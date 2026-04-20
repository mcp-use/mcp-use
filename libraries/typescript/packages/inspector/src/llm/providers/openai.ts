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

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

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
  // Data URLs in images stay as-is; OpenAI accepts them.
  void parseDataUrl; // silence unused import warning (shared helper lives here for anthropic)
  return out;
}

export async function* streamChat(
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

  const res = await fetch(DEFAULT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenAI request failed (${res.status} ${res.statusText}): ${text}`
    );
  }

  // Track per-index buffered tool call info so we can emit a final
  // `tool-call-ready` with fully-parsed args.
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
  const res = await fetch(DEFAULT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenAI request failed (${res.status} ${res.statusText}): ${text}`
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
