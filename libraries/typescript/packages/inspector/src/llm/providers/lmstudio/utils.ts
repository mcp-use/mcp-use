export const DEFAULT_LMSTUDIO_BASE_URL = "http://localhost:1234/v1";

export function normalizeLmStudioBaseUrl(baseUrl?: string): string {
  const trimmed = (baseUrl || DEFAULT_LMSTUDIO_BASE_URL)
    .trim()
    .replace(/\/+$/, "");

  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function buildLmStudioApiUrl(
  baseUrl: string | undefined,
  path: `/v1/${string}`
): string {
  return `${normalizeLmStudioBaseUrl(baseUrl)}${path.slice(3)}`;
}
