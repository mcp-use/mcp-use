import { parseDataUrl } from "@/llm/messageFormat";
import { parseNDJSON } from "@/llm/ndjson";
import type {
  ContentPart,
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderTool,
} from "../../types";
import { fetchLocalProvider } from "../localProviderFetch";
import { buildOllamaApiUrl } from "./utils";

interface ChatParams {
  config: ProviderConfig;
  messages: ProviderMessage[];
  tools?: ProviderTool[];
  signal?: AbortSignal;
}

function toOllamaImages(content: ContentPart[]): string[] {
  const images: string[] = [];

  for (const part of content) {
    if (part.type !== "image") continue;

    if (part.data) {
      images.push(part.data);
      continue;
    }

    const parsed = parseDataUrl(part.url);
    if (parsed?.data) {
      images.push(parsed.data);
    }
  }

  return images;
}

function toOllamaContent(content: string | ContentPart[]): {
  content: string;
  images?: string[];
} {
  if (typeof content === "string") {
    return { content };
  }

  const text = content
    .filter(
      (part): part is Extract<ContentPart, { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("");

  const images = toOllamaImages(content);
  return {
    content: text,
    ...(images.length > 0 ? { images } : {}),
  };
}

function toOllamaMessages(messages: ProviderMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_name: message.toolName,
        content:
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.toolResult ?? message.content),
      };
    }

    if (message.role === "assistant") {
      const content =
        typeof message.content === "string"
          ? { content: message.content }
          : toOllamaContent(message.content);

      return {
        role: "assistant",
        ...content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((toolCall, index) => ({
                type: "function",
                function: {
                  index,
                  name: toolCall.name,
                  arguments: toolCall.args,
                },
              })),
            }
          : {}),
      };
    }

    return {
      role: message.role,
      ...toOllamaContent(message.content),
    };
  });
}

function buildBody(params: ChatParams, stream: boolean) {
  const { config, messages, tools } = params;
  const body: Record<string, unknown> = {
    model: config.model,
    messages: toOllamaMessages(messages),
    stream,
  };

  const options: Record<string, unknown> = {};
  if (config.temperature !== undefined)
    options.temperature = config.temperature;
  if (config.maxTokens !== undefined) options.num_predict = config.maxTokens;
  if (Object.keys(options).length > 0) body.options = options;

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

function buildHeaders(config: ProviderConfig): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(config.apiKey.trim()
      ? { Authorization: `Bearer ${config.apiKey.trim()}` }
      : {}),
  };
}

function normalizeToolCalls(toolCalls: unknown): Array<{
  id: string;
  name: string;
  args: Record<string, unknown>;
}> {
  if (!Array.isArray(toolCalls)) return [];

  return toolCalls
    .map((toolCall, index) => {
      const functionCall =
        toolCall && typeof toolCall === "object"
          ? (toolCall as { function?: Record<string, unknown> }).function
          : undefined;

      const name =
        typeof functionCall?.name === "string" ? functionCall.name : "";
      const rawArgs = functionCall?.arguments;
      const args =
        rawArgs && typeof rawArgs === "object"
          ? (rawArgs as Record<string, unknown>)
          : {};

      return {
        id: `call_${index}_${name || "tool"}`,
        name,
        args,
      };
    })
    .filter((toolCall) => toolCall.name);
}

export async function* streamChat(
  params: ChatParams
): AsyncGenerator<LlmStreamEvent, void, unknown> {
  const { config, signal } = params;
  const res = await fetchLocalProvider(
    buildOllamaApiUrl(config.baseUrl, "/api/chat"),
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
      `Ollama request failed (${res.status} ${res.statusText}): ${text}`
    );
  }

  let emittedToolCalls = 0;

  for await (const chunk of parseNDJSON(res.body, signal)) {
    const message =
      chunk && typeof chunk === "object"
        ? (chunk as { message?: Record<string, unknown> }).message
        : undefined;

    if (typeof message?.content === "string" && message.content.length > 0) {
      yield { type: "text-delta", delta: message.content };
    }

    const toolCalls = normalizeToolCalls(message?.tool_calls);
    if (toolCalls.length > 0) {
      for (const [offset, toolCall] of toolCalls.entries()) {
        const index = emittedToolCalls + offset;
        yield {
          type: "tool-call-start",
          index,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        };

        const argsJson = JSON.stringify(toolCall.args);
        if (argsJson && argsJson !== "{}") {
          yield {
            type: "tool-call-args-delta",
            index,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            argsDelta: argsJson,
          };
        }

        yield {
          type: "tool-call-ready",
          index,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          args: toolCall.args,
        };
      }

      emittedToolCalls += toolCalls.length;
    }

    if (
      chunk &&
      typeof chunk === "object" &&
      (chunk as { error?: unknown }).error
    ) {
      yield {
        type: "error",
        message: String((chunk as { error: unknown }).error),
      };
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
    buildOllamaApiUrl(config.baseUrl, "/api/chat"),
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
      `Ollama request failed (${res.status} ${res.statusText}): ${text}`
    );
  }

  const json = await res.json();
  const message = json?.message ?? {};

  return {
    text: typeof message.content === "string" ? message.content : "",
    toolCalls: normalizeToolCalls(message.tool_calls),
  };
}
