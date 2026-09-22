import type { Context } from "hono";
import { createHash } from "node:crypto";
import { RateLimiterMemory } from "rate-limiter-flexible";

export const INSPECTOR_ASSET_RATE_LIMIT = 600;
export const INSPECTOR_API_RATE_LIMIT = 120;
/** Backstop across every proxied target in one Inspector process. */
export const INSPECTOR_GLOBAL_API_RATE_LIMIT = 1_200;
/** Small per-client budget protecting the embedding application's auth hook. */
export const INSPECTOR_PREAUTH_RATE_LIMIT = 60;
/** Process-wide pre-auth backstop against IP/key rotation DoS. */
export const INSPECTOR_GLOBAL_PREAUTH_RATE_LIMIT = 6_000;
export const INSPECTOR_RATE_LIMIT_WINDOW_SECONDS = 60;

/** Shared defaults: every mounted relay in one process uses the same budgets. */
export const defaultInspectorGlobalRateLimiter = new RateLimiterMemory({
  points: INSPECTOR_GLOBAL_API_RATE_LIMIT,
  duration: INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
});
export const defaultInspectorPreAuthRateLimiter = new RateLimiterMemory({
  points: INSPECTOR_PREAUTH_RATE_LIMIT,
  duration: INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
});
export const defaultInspectorGlobalPreAuthRateLimiter = new RateLimiterMemory({
  points: INSPECTOR_GLOBAL_PREAUTH_RATE_LIMIT,
  duration: INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
});

/**
 * Build a bounded, non-sensitive limiter key for one logical upstream server.
 * Query strings, fragments, credentials, and malformed values never become
 * keys or let callers evade a server's budget by varying irrelevant values.
 */
export function inspectorServerRateLimitKey(
  namespace: "mcp" | "oauth",
  value: string | undefined
): string {
  if (!value) return `${namespace}:unknown`;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return `${namespace}:unknown`;
    }
    const rawPathname = url.pathname.replace(/\/+$/, "") || "/";
    const pathname =
      rawPathname.length > 256
        ? `/__path_hash/${createHash("sha256").update(rawPathname).digest("hex")}`
        : rawPathname;
    return `${namespace}:${url.origin}${pathname}`;
  } catch {
    return `${namespace}:unknown`;
  }
}

/** Build a bounded non-secret pre-auth key from edge-provided client identity. */
export function inspectorRelayPreAuthKey(
  cloudflareConnectingIp: string | undefined,
  forwardedFor: string | undefined
): string {
  const identity =
    cloudflareConnectingIp?.trim() || forwardedFor?.split(",", 1)[0]?.trim();
  const digest = createHash("sha256")
    .update(identity || "unknown")
    .digest("hex");
  return `inspector-relay:preauth:${digest}`;
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
