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
 * caller keys.
 */
export function inspectorApiRateLimit(limiter: RateLimiterMemory) {
  return async (c: Context, next: Next) => {
    try {
      await limiter.consume(clientKey(c));
      await processApiLimiter.consume("process");
    } catch (error) {
      return inspectorRateLimitResponse(c, error);
    }
    return next();
  };
}

/** Platforms such as Vercel and Railway set X-Real-IP to the client address. */
function clientKey(c: Context): string {
  return (
    c.req.header("x-real-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
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
