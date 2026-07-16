import type {
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderTool,
} from "../types.js";
import * as anthropic from "./anthropic.js";
import * as google from "./google.js";
import * as ollama from "./ollama/index.js";
import * as openaiCompletions from "./openai-chat-completions.js";

interface ChatParams {
  config: ProviderConfig;
  messages: ProviderMessage[];
  tools?: ProviderTool[];
  signal?: AbortSignal;
}

interface ChatResult {
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
      throw new Error(
        "provider 'openai' uses the Responses API via OpenAIResponsesDriver, not streamChat"
      );
    case "openai-compatible":
      return openaiCompletions.streamChat(params);
    case "anthropic":
      return anthropic.streamChat(params);
    case "google":
      return google.streamChat(params);
    case "openrouter":
      return openaiCompletions.streamChat(withOpenRouter(params));
    case "ollama":
      return ollama.streamChat(params);
    default:
      throw new Error(`Unsupported LLM provider: ${params.config.provider}`);
  }
}

export function chat(params: ChatParams): Promise<ChatResult> {
  switch (params.config.provider) {
    case "openai":
      throw new Error(
        "provider 'openai' uses the Responses API via OpenAIResponsesDriver, not chat"
      );
    case "openai-compatible":
      return openaiCompletions.chat(params);
    case "anthropic":
      return anthropic.chat(params);
    case "google":
      return google.chat(params);
    case "openrouter":
      return openaiCompletions.chat(withOpenRouter(params));
    case "ollama":
      return ollama.chat(params);
    default:
      throw new Error(`Unsupported LLM provider: ${params.config.provider}`);
  }
}
