import type { ProviderName } from "@/llm/types";

export interface MessageAttachment {
  type: "image" | "file";
  data: string; // base64 encoded
  mimeType: string;
  name?: string;
  size?: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string | Array<{ index: number; type: string; text: string }>;
  timestamp: number;
  attachments?: MessageAttachment[];
  parts?: Array<{
    type: "text" | "tool-invocation";
    text?: string;
    toolInvocation?: {
      toolName: string;
      args: Record<string, unknown>;
      result?: any;
      state?: "pending" | "streaming" | "result" | "error";
      /** Best-effort parsed partial arguments while the LLM is still generating */
      partialArgs?: Record<string, unknown>;
    };
  }>;
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result?: any;
  }>;
}

export interface LLMConfig {
  provider: ProviderName;
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
}

export interface AuthConfig {
  type: "none" | "basic" | "bearer" | "oauth";
  username?: string;
  password?: string;
  token?: string;
  oauthTokens?: {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
  };
}

export interface MCPServerConfig {
  url?: string;
  transport?: "http" | "sse";
  headers?: Record<string, string>;
  authToken?: string;
  auth_token?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  preferSse?: boolean;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

export type StreamProtocol = "sse" | "data-stream";

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: "gpt-4o",
  anthropic: "claude-haiku-4-5-20251001",
  google: "gemini-2.5-flash",
  ollama: "qwen3",
  lmstudio: "local-model",
};

export const DEFAULT_BASE_URLS: Partial<Record<ProviderName, string>> = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234/v1",
};

export function providerRequiresApiKey(provider: ProviderName): boolean {
  return provider !== "ollama" && provider !== "lmstudio";
}

export function providerSupportsBaseUrl(provider: ProviderName): boolean {
  return provider === "ollama" || provider === "lmstudio";
}

export function getDefaultBaseUrl(provider: ProviderName): string {
  return DEFAULT_BASE_URLS[provider] ?? "";
}
