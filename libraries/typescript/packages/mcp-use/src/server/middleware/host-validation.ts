/**
 * Host Header Validation Middleware
 *
 * DNS rebinding protection for Hono-based MCP servers. Backed by an
 * `OriginResolver` that may be static (plain `string[]` form of
 * `allowedOrigins`) or dynamic (object form with wildcards / provider /
 * webhook). The resolver is always consulted synchronously — it caches
 * last-known-good — so this middleware adds essentially zero per-request
 * overhead.
 *
 * Security posture:
 *   - Unknown Host → 403 (DNS rebinding protection).
 *   - Cold-start failure (dynamic resolver configured, initial fetch failed,
 *     no static fallback) → 503. We FAIL CLOSED rather than silently accept
 *     every Host when the provider is down at boot.
 *   - Host validation uses only the `Host` header, never
 *     `X-Forwarded-Host`, to prevent header injection.
 */

import type { Context, Next } from "hono";
import type { OriginResolver } from "../utils/origin-resolver.js";

function createJsonRpcErrorResponse(
  c: Context,
  status: number,
  message: string
): Response {
  return c.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message,
      },
      id: null,
    },
    status as 403 | 503
  );
}

function parseHostnameFromHostHeader(hostHeader: string): string | null {
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Create middleware that validates the Host header against the resolver's
 * current allow-list (static + last-known-good from any dynamic provider).
 *
 * Returns `null` when validation should be skipped entirely (e.g. the user
 * didn't configure `allowedOrigins` at all) so callers can avoid paying the
 * per-request middleware cost on servers that don't use Host validation.
 */
export function hostHeaderValidation(resolver: OriginResolver) {
  return async (c: Context, next: Next) => {
    // Cold-start failure: dynamic providers were configured but we never
    // got a single good list. Fail closed rather than accept any Host.
    if (resolver.isColdStartFailure()) {
      return createJsonRpcErrorResponse(
        c,
        503,
        "Origin allow-list unavailable"
      );
    }

    const hostHeader = c.req.header("Host");
    if (!hostHeader) {
      return createJsonRpcErrorResponse(c, 403, "Missing Host header");
    }

    const hostname = parseHostnameFromHostHeader(hostHeader);
    if (!hostname) {
      return createJsonRpcErrorResponse(
        c,
        403,
        `Invalid Host header: ${hostHeader}`
      );
    }

    if (!resolver.matchesHostname(hostname)) {
      return createJsonRpcErrorResponse(c, 403, `Invalid Host: ${hostname}`);
    }

    await next();
  };
}
