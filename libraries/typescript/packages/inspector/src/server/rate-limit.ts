import type { Context } from "hono";

export const INSPECTOR_ASSET_RATE_LIMIT = 600;
export const INSPECTOR_API_RATE_LIMIT = 120;
export const INSPECTOR_RATE_LIMIT_WINDOW_SECONDS = 60;

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
    typeof error.msBeforeNext === "number"
  ) {
    return Math.max(1, Math.ceil(error.msBeforeNext / 1_000));
  }
  return 60;
}
