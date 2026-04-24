import { parseDataUrl } from "@/llm/messageFormat";
import { parseSSE } from "@/llm/sse";
import type {
  ContentPart,
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderTool,
} from "../../types";
import { fetchLocalProvider } from "../localProviderFetch";
import { buildLmStudioApiUrl } from "./utils";

interface ChatParams {
  config: ProviderConfig;
  messages: ProviderMessage[];
  tools?: ProviderTool[];
  signal?: AbortSignal;
}

function toOpenAICompatibleContent(content: string | ContentPart[]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    return { type: "image_url", image_url: { url: part.url } };
  });
}

function toOpenAICompatibleMessages(messages: ProviderMessage[]): unknown[] {
  const out: unknown[] = [];

  for (const message of messages) {
    if (message.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        content:
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.toolResult ?? message.content),
      });
      continue;
    }

    if (message.role === "assistant") {
      const entry: Record<string, unknown> = {
        role: "assistant",
        content:
          typeof message.content === "string" && message.content.length > 0
            ? message.content
            : null,
      };

      if (message.toolCalls?.length) {
        entry.tool_calls = message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.args),
          },
        }));
      }

      out.push(entry);
      continue;
    }

    out.push({
      role: message.role,
      content: toOpenAICompatibleContent(message.content),
    });
  }

  void parseDataUrl;
  return out;
}

function buildHeaders(config: ProviderConfig): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(config.apiKey.trim()
      ? { Authorization: `Bearer ${config.apiKey.trim()}` }
      : {}),
  };
}

function buildBody(
  params: ChatParams,
  stream: boolean
): Record<string, unknown> {
  const { config, messages, tools } = params;
  const body: Record<string, unknown> = {
    model: config.model,
    messages: toOpenAICompatibleMessages(messages),
    stream,
  };

  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens;

  if (tools && tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  return body;
}

export async function* streamChat(
  params: ChatParams
): AsyncGenerator<LlmStreamEvent, void, unknown> {
  const { config, signal } = params;
  const res = await fetchLocalProvider(
    buildLmStudioApiUrl(config.baseUrl, "/v1/chat/completions"),
    {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify(buildBody(params, true)),
      signal,
    }
  );

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `LM Studio request failed (${res.status} ${res.statusText}): ${text}`
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
      for (const toolCall of delta.tool_calls) {
        const index = typeof toolCall.index === "number" ? toolCall.index : 0;
        let buffer = buffers.get(index);

        if (!buffer) {
          buffer = {
            id: toolCall.id ?? `call_${index}`,
            name: toolCall.function?.name ?? "",
            argsJson: "",
            started: false,
          };
          buffers.set(index, buffer);
        }

        if (toolCall.id) buffer.id = toolCall.id;
        if (toolCall.function?.name) buffer.name = toolCall.function.name;

        if (!buffer.started && buffer.name) {
          buffer.started = true;
          yield {
            type: "tool-call-start",
            index,
            toolCallId: buffer.id,
            toolName: buffer.name,
          };
        }

        const argsChunk: string | undefined = toolCall.function?.arguments;
        if (typeof argsChunk === "string" && argsChunk.length > 0) {
          buffer.argsJson += argsChunk;
          if (buffer.started) {
            yield {
              type: "tool-call-args-delta",
              index,
              toolCallId: buffer.id,
              toolName: buffer.name,
              argsDelta: argsChunk,
            };
          }
        }
      }
    }

    if (choice.finish_reason) {
      for (const [index, buffer] of buffers) {
        let args: Record<string, unknown> = {};
        if (buffer.argsJson) {
          try {
            args = JSON.parse(buffer.argsJson);
          } catch {
            args = {};
          }
        }

        yield {
          type: "tool-call-ready",
          index,
          toolCallId: buffer.id,
          toolName: buffer.name,
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
  const { config, signal } = params;
  const res = await fetchLocalProvider(
    buildLmStudioApiUrl(config.baseUrl, "/v1/chat/completions"),
    {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify(buildBody(params, false)),
      signal,
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `LM Studio request failed (${res.status} ${res.statusText}): ${text}`
    );
  }

  const json = await res.json();
  const choice = json?.choices?.[0]?.message;
  const text: string =
    typeof choice?.content === "string" ? choice.content : "";
  const toolCalls = Array.isArray(choice?.tool_calls)
    ? choice.tool_calls.map((toolCall: any) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall?.function?.arguments ?? "{}");
        } catch {
          args = {};
        }

        return {
          id: toolCall.id,
          name: toolCall.function?.name ?? "",
          args,
        };
      })
    : [];

  return { text, toolCalls };
}
