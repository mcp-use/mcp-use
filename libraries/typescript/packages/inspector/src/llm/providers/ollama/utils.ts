export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

export function normalizeOllamaBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_OLLAMA_BASE_URL).trim();
  let end = raw.length;
  while (end > 0 && raw.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  const trimmed = raw.slice(0, end);

  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

export function buildOllamaApiUrl(
  baseUrl: string | undefined,
  path: `/api/${string}`
): string {
  return `${normalizeOllamaBaseUrl(baseUrl)}${path}`;
}

export class OllamaCorsError extends Error {
  constructor(cause: unknown) {
    super(
      "Could not reach Ollama. If it's running, allow this origin by starting Ollama with " +
        "`OLLAMA_ORIGINS=*` (or your inspector origin) and try again."
    );
    this.name = "OllamaCorsError";
    this.cause = cause;
  }
}
