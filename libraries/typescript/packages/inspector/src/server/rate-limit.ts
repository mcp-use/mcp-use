import type { MiddlewareHandler } from "hono";
import RateLimiterMemory from "rate-limiter-flexible/lib/RateLimiterMemory.js";

type RateLimitOptions = {
  points: number;
  durationSeconds: number;
  key: string;
};

export const INSPECTOR_ASSET_RATE_LIMIT = 600;
export const INSPECTOR_API_RATE_LIMIT = 120;
export const INSPECTOR_RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * Create a process-local fixed-window limiter for Inspector HTTP routes.
 *
 * @internal
 */
export function createInspectorRateLimiter(
  options: RateLimitOptions
): MiddlewareHandler {
  const limiter = new RateLimiterMemory({
    points: options.points,
    duration: options.durationSeconds,
  });

  return async (c, next) => {
    try {
      await limiter.consume(options.key);
    } catch (error) {
      c.header("Retry-After", String(retryAfterSeconds(error)));
      return c.json({ error: "Too Many Requests" }, 429);
    }
    await next();
  };
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
