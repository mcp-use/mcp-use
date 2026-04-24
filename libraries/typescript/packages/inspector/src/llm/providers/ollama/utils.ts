export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

export function normalizeOllamaBaseUrl(baseUrl?: string): string {
  const trimmed = (baseUrl || DEFAULT_OLLAMA_BASE_URL)
    .trim()
    .replace(/\/+$/, "");

  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

export function buildOllamaApiUrl(
  baseUrl: string | undefined,
  path: `/api/${string}`
): string {
  return `${normalizeOllamaBaseUrl(baseUrl)}${path}`;
}
