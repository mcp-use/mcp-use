import type { Context } from "hono";

export const INSPECTOR_ASSET_RATE_LIMIT = 600;
export const INSPECTOR_API_RATE_LIMIT = 120;
/** Backstop across every proxied target in one Inspector process. */
export const INSPECTOR_GLOBAL_API_RATE_LIMIT = 1200;
export const INSPECTOR_RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * Build a process-local limiter key for one logical MCP server.
 *
 * Inspector proxy routes are shared by every saved connection and every user
 * of a hosted Inspector process. Keying the limiter with the Hono request
 * object stringifies every request to the same value, so one busy server (or
 * background health probes) can exhaust the budget for unrelated servers.
 * Keep the query and fragment out of the key: they may contain credentials and
 * must not let callers evade a server's budget by varying irrelevant values.
 */
export function inspectorServerRateLimitKey(
  namespace: "mcp" | "oauth",
  serverUrl: string | undefined
): string {
  if (!serverUrl) return `${namespace}:unknown`;

  try {
    const url = new URL(serverUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return `${namespace}:unknown`;
    }
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${namespace}:${url.origin}${pathname}`;
  } catch {
    return `${namespace}:unknown`;
  }
}

/** Return the standard Inspector response for an exhausted route budget. */
export function inspectorRateLimitResponse(c: Context, error: unknown) {
  c.header("Retry-After", String(retryAfterSeconds(error)));
  return c.json({ error: "Too Many Requests" }, 429);
}

function retryAfterSeconds(error: unknown): number {
  if (
    error &&
    typeof error === "object" &&
    "msBeforeNext" in error &&
    typeof error.msBeforeNext === "number" &&
    Number.isFinite(error.msBeforeNext)
  ) {
    return Math.max(1, Math.ceil(error.msBeforeNext / 1_000));
  }
  return 60;
}
