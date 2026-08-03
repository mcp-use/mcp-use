/** Default origin used by a local Ollama installation. */
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/**
 * Normalizes an Ollama origin for use with `/api/*` endpoints.
 *
 * @param baseUrl - Ollama origin, optionally ending in `/` or `/api`.
 * @returns The origin without trailing slashes or a trailing `/api`.
 */
export function normalizeOllamaBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_OLLAMA_BASE_URL).trim();
  let end = raw.length;
  while (end > 0 && raw.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  const trimmed = raw.slice(0, end);

  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

/**
 * Builds an absolute URL for an Ollama API endpoint.
 *
 * @param baseUrl - Ollama origin. Defaults to
 * {@link DEFAULT_OLLAMA_BASE_URL}.
 * @param path - Endpoint path beginning with `/api/`.
 * @returns An absolute endpoint URL.
 */
export function buildOllamaApiUrl(
  baseUrl: string | undefined,
  path: `/api/${string}`
): string {
  return `${normalizeOllamaBaseUrl(baseUrl)}${path}`;
}

/**
 * Indicates that a browser could not reach Ollama, commonly because its CORS
 * origin allowlist rejected the request.
 */
export class OllamaCorsError extends Error {
  /**
   * @param cause - Original network error.
   */
  constructor(cause: unknown) {
    super(
      "Could not reach Ollama. If it's running, allow this origin by starting Ollama with " +
        "`OLLAMA_ORIGINS=*` (or your inspector origin) and try again."
    );
    this.name = "OllamaCorsError";
    this.cause = cause;
  }
}
