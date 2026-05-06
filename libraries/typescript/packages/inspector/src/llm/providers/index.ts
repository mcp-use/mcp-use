import type {
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderTool,
} from "../types";
import * as anthropic from "./anthropic";
import * as google from "./google";
import * as openai from "./openai";

export interface ChatParams {
  config: ProviderConfig;
  messages: ProviderMessage[];
  tools?: ProviderTool[];
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
}

/** Patches ChatParams with OpenRouter's base URL and required headers. */
function withOpenRouter(params: ChatParams): ChatParams {
  return {
    ...params,
    config: {
      ...params.config,
      baseUrl: "https://openrouter.ai/api/v1",
      extraHeaders: {
        "HTTP-Referer": "https://inspector.mcp-use.com",
        "X-Title": "mcp-use Inspector",
      },
    },
  };
}

export function streamChat(
  params: ChatParams
): AsyncGenerator<LlmStreamEvent, void, unknown> {
  switch (params.config.provider) {
    case "openai":
    case "openai-compatible":
      return openai.streamChat(params);
    case "anthropic":
      return anthropic.streamChat(params);
    case "google":
      return google.streamChat(params);
    case "openrouter":
      return openai.streamChat(withOpenRouter(params));
    default:
      throw new Error(`Unsupported LLM provider: ${params.config.provider}`);
  }
}

export function chat(params: ChatParams): Promise<ChatResult> {
  switch (params.config.provider) {
    case "openai":
    case "openai-compatible":
      return openai.chat(params);
    case "anthropic":
      return anthropic.chat(params);
    case "google":
      return google.chat(params);
    case "openrouter":
      return openai.chat(withOpenRouter(params));
    default:
      throw new Error(`Unsupported LLM provider: ${params.config.provider}`);
  }
}
