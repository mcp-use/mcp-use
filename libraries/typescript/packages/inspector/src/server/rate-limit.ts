import type { Context, Next } from "hono";
import { RateLimiterMemory } from "rate-limiter-flexible";

export const INSPECTOR_ASSET_RATE_LIMIT = 600;
export const INSPECTOR_API_RATE_LIMIT = 120;
/** Ceiling for all callers of the proxy and OAuth BFF in one process. */
export const INSPECTOR_API_PROCESS_RATE_LIMIT = 1_200;
export const INSPECTOR_RATE_LIMIT_WINDOW_SECONDS = 60;

const processApiLimiter = new RateLimiterMemory({
  points: INSPECTOR_API_PROCESS_RATE_LIMIT,
  duration: INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
});

/**
 * Proxy/OAuth budget per caller (client IP), so one busy caller cannot exhaust
 * the API for everyone, under a process-wide ceiling for rotating or spoofed
 * caller keys. Requests that didn't pass through a platform proxy (a local
 * Inspector or `mcp-use dev`) can't be told apart, so only the ceiling applies.
 */
export function inspectorApiRateLimit(limiter: RateLimiterMemory) {
  return async (c: Context, next: Next) => {
    try {
      const key = clientKey(c);
      if (key) await limiter.consume(key);
      await processApiLimiter.consume("process");
    } catch (error) {
      return inspectorRateLimitResponse(c, error);
    }
    return next();
  };
}

/**
 * The rightmost X-Forwarded-For entry is the peer the platform proxy saw
 * (Vercel overwrites the header, Railway appends to it), so a client behind it
 * cannot pick its own budget by sending the header. Without a proxy (local
 * CLI) the header is the client's own and only the process ceiling holds.
 */
function clientKey(c: Context): string | undefined {
  return (
    c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() || undefined
  );
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
