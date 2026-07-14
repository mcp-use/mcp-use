import type {
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderTool,
} from "../types";
import * as anthropic from "./anthropic";
import * as openai from "./openai";

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

export const MINIMAX_MODELS = ["MiniMax-M3", "MiniMax-M2.7"] as const;

export const MINIMAX_ENDPOINTS = [
  {
    id: "global_en-openai",
    region: "global_en",
    label: "Global (OpenAI-compatible)",
    baseUrl: "https://api.minimax.io/v1",
    protocol: "openai",
  },
  {
    id: "cn_zh-openai",
    region: "cn_zh",
    label: "China (OpenAI-compatible)",
    baseUrl: "https://api.minimaxi.com/v1",
    protocol: "openai",
  },
  {
    id: "global_en-anthropic",
    region: "global_en",
    label: "Global (Anthropic-compatible)",
    baseUrl: "https://api.minimax.io/anthropic",
    protocol: "anthropic",
  },
  {
    id: "cn_zh-anthropic",
    region: "cn_zh",
    label: "China (Anthropic-compatible)",
    baseUrl: "https://api.minimaxi.com/anthropic",
    protocol: "anthropic",
  },
] as const;

export const DEFAULT_MINIMAX_BASE_URL = MINIMAX_ENDPOINTS[0].baseUrl;

function usesAnthropicProtocol(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  const endpoint = MINIMAX_ENDPOINTS.find(
    (candidate) => candidate.baseUrl === baseUrl
  );
  return endpoint?.protocol === "anthropic" || baseUrl.endsWith("/anthropic");
}

function withBearerAuth(params: ChatParams): ChatParams {
  if (!params.config.apiKey) return params;
  return {
    ...params,
    config: {
      ...params.config,
      extraHeaders: {
        ...params.config.extraHeaders,
        Authorization: `Bearer ${params.config.apiKey}`,
      },
    },
  };
}

export function streamChat(
  params: ChatParams
): AsyncGenerator<LlmStreamEvent, void, unknown> {
  const configured = withBearerAuth(params);
  return usesAnthropicProtocol(configured.config.baseUrl)
    ? anthropic.streamChat(configured)
    : openai.streamChat(configured);
}

export function chat(params: ChatParams): Promise<ChatResult> {
  const configured = withBearerAuth(params);
  return usesAnthropicProtocol(configured.config.baseUrl)
    ? anthropic.chat(configured)
    : openai.chat(configured);
}
