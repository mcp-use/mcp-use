import type { ProviderConfig } from "../types.js";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export function buildEndpoint(
  config: ProviderConfig,
  path: string
): string {
  const base = config.baseUrl ?? OPENAI_BASE_URL;
  return `${base.replace(/\/$/, "")}${path}`;
}

export function buildHeaders(config: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...config.extraHeaders,
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

export async function readOpenAIError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `OpenAI request failed (${res.status} ${res.statusText}): ${text}`;
}
