import type {
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderTool,
} from "../types";
import * as anthropic from "./anthropic";
import * as google from "./google";
import * as openai from "./openai";
import * as openrouter from "./openrouter";

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

export function streamChat(
  params: ChatParams
): AsyncGenerator<LlmStreamEvent, void, unknown> {
  switch (params.config.provider) {
    case "openai":
      return openai.streamChat(params);
    case "anthropic":
      return anthropic.streamChat(params);
    case "google":
      return google.streamChat(params);
    case "openrouter":
      return openrouter.streamChat(params);
    default:
      throw new Error(`Unsupported LLM provider: ${params.config.provider}`);
  }
}

export function chat(params: ChatParams): Promise<ChatResult> {
  switch (params.config.provider) {
    case "openai":
      return openai.chat(params);
    case "anthropic":
      return anthropic.chat(params);
    case "google":
      return google.chat(params);
    case "openrouter":
      return openrouter.chat(params);
    default:
      throw new Error(`Unsupported LLM provider: ${params.config.provider}`);
  }
}

