import type { ProviderConfig } from "../types.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

/** HTTP error returned by an LLM provider request. */
export class LlmRequestError extends Error {
  /** HTTP response status. */
  readonly status: number;
  /** Parsed JSON response body, or the raw response text. */
  readonly body?: unknown;

  /**
   * @param status - HTTP response status.
   * @param message - Error message.
   * @param body - Parsed or raw provider response body.
   */
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "LlmRequestError";
    this.status = status;
    this.body = body;
  }
}

export function buildEndpoint(config: ProviderConfig, path: string): string {
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

export async function throwLlmRequestError(res: Response): Promise<never> {
  const text = await res.text().catch(() => "");
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // keep raw text
    }
  }
  throw new LlmRequestError(
    res.status,
    `OpenAI request failed (${res.status} ${res.statusText}): ${text}`,
    body
  );
}
