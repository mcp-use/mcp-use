/**
 * MCP Proxy Middleware for Hono
 *
 * Provides a CORS proxy for browser-based MCP clients to connect to remote MCP servers
 * that don't support CORS or require server-side forwarding.
 *
 * @module mcp-proxy
 */

import type { Context, Hono, Next } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { RateLimiterMemory } from "rate-limiter-flexible";
import {
  INSPECTOR_API_RATE_LIMIT,
  INSPECTOR_GLOBAL_API_RATE_LIMIT,
  INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
  inspectorServerRateLimitKey,
  inspectorRateLimitResponse,
} from "../rate-limit.js";
// ponytail: vendored from mcp-use/src/server/middleware/mcp-proxy.ts — keep in sync manually.
import { isSafeProxyTarget } from "./oauth-proxy.js";

const MAX_REDIRECTS = 3;

/**
 * Options for configuring the MCP proxy middleware
 */
interface McpProxyOptions {
  /**
   * Route path for the proxy endpoint
   * @default "/mcp/proxy"
   * @example "/inspector/api/proxy"
   */
  path?: string;

  /**
   * Optional authentication function to validate requests
   * Return true to allow the request, false to reject with 401
   *
   * @example
   * ```typescript
   * authenticate: async (c) => {
   *   const apiKey = c.req.header("X-API-Key");
   *   return apiKey === process.env.API_KEY;
   * }
   * ```
   */
  authenticate?: (c: Context) => Promise<boolean> | boolean;

  /**
   * Optional request validator to check if target URL is allowed
   * Return true to allow, false to reject with 403
   *
   * @example
   * ```typescript
   * validateRequest: (targetUrl) => {
   *   // Only allow specific domains
   *   return targetUrl.startsWith("https://api.example.com");
   * }
   * ```
   */
  validateRequest?: (
    targetUrl: string,
    c: Context
  ) => Promise<boolean> | boolean;

  /** Permit loopback HTTP targets for explicit local development. */
  allowLoopback?: boolean;

  /**
   * Enable request logging
   * @default true
   */
  enableLogging?: boolean;
  /** Shared process-local limiter for Inspector proxy and OAuth routes. */
  rateLimiter?: RateLimiterMemory;
  /** Higher process-wide backstop against target-key rotation abuse. */
  globalRateLimiter?: RateLimiterMemory;
  /** Optional source label for logs when Inspector shares a dev server process. */
  logPrefix?: string;
  /** Explicit browser origins. Omission preserves legacy wildcard CORS; `[]` denies cross-origin callers. */
  allowedOrigins?: readonly string[];
}

/** Whether an MCP response must remain streaming instead of being buffered. */
export function isOpenEndedSseResponse(
  contentType: string,
  contentLength: string | null
): boolean {
  return contentType.includes("text/event-stream") && !contentLength;
}

/**
 * Mount MCP proxy middleware on a Hono app
 *
 * This middleware proxies MCP requests to target servers based on the X-Target-URL header.
 * It handles CORS, streaming responses (SSE), and provides optional authentication.
 *
 * The proxy:
 * 1. Reads the target URL from the X-Target-URL header
 * 2. Forwards the request to that URL with appropriate headers
 * 3. Streams the response back to the client
 * 4. Handles compression and encoding correctly
 *
 * @param app - Hono application instance
 * @param options - Configuration options for the proxy
 *
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { mountMcpProxy } from "mcp-use";
 *
 * const app = new Hono();
 *
 * // Basic usage
 * mountMcpProxy(app);
 *
 * // With authentication
 * mountMcpProxy(app, {
 *   path: "/api/proxy",
 *   authenticate: async (c) => {
 *     const token = c.req.header("Authorization");
 *     return token === `Bearer ${process.env.SECRET_TOKEN}`;
 *   },
 *   validateRequest: (targetUrl) => {
 *     // Only allow specific domains
 *     return targetUrl.startsWith("https://mcp.example.com");
 *   }
 * });
 * ```
 *
 * @remarks
 * WARNING: This proxy does not implement authentication by default.
 * For production use, provide an `authenticate` function or restrict access to localhost only.
 */
export function mountMcpProxy(app: Hono, options: McpProxyOptions = {}): void {
  const basePath = options.path || "/mcp/proxy";
  const enableLogging = options.enableLogging !== false;
  const logPrefix = options.logPrefix;
  const rateLimiter =
    options.rateLimiter ??
    new RateLimiterMemory({
      points: INSPECTOR_API_RATE_LIMIT,
      duration: INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
    });
  const globalRateLimiter =
    options.globalRateLimiter ??
    new RateLimiterMemory({
      points: INSPECTOR_GLOBAL_API_RATE_LIMIT,
      duration: INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
    });
  const rateLimit = async (c: Context, next: Next) => {
    try {
      // Keep independent budgets per actual target. Passing the Request object
      // here stringifies every request to "[object Request]" and creates one
      // accidental process-wide bucket.
      await globalRateLimiter.consume("inspector-api:global");
      await rateLimiter.consume(
        inspectorServerRateLimitKey("mcp", c.req.header("X-Target-URL"))
      );
    } catch (error) {
      return inspectorRateLimitResponse(c, error);
    }
    return next();
  };

  // CRITICAL: Enable CORS and expose all headers for FastMCP session management
  // The Mcp-Session-Id header MUST be exposed for the browser to read it
  // NOTE: Authorization must be listed explicitly — the wildcard * does NOT cover it per the Fetch spec.
  app.use(
    `${basePath}/*`,
    cors({
      origin: createCorsOriginResolver(options.allowedOrigins),
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "Accept",
        "X-Target-URL",
        "X-MCP-Target",
        "Mcp-Session-Id",
        "mcp-session-id",
        "mcp-protocol-version",
        "Mcp-Protocol-Version",
        "Mcp-Method",
        "Mcp-Name",
        "DPoP",
        "Last-Event-ID",
        "X-Server-Id",
        "X-Requested-With",
      ],
      exposeHeaders: [
        "Mcp-Session-Id",
        "Mcp-Protocol-Version",
        "WWW-Authenticate",
        "Location",
        "Retry-After",
        "X-Accel-Buffering",
      ],
    })
  );

  // Apply logger middleware to proxy routes
  if (enableLogging) {
    app.use(
      `${basePath}/*`,
      logPrefix === undefined
        ? logger()
        : logger((message, ...args) => console.log(logPrefix, message, ...args))
    );
  }

  // CORS preflights do not carry the browser's capability. Authenticate every
  // other request before it can consume either relay budget, so rejected
  // callers cannot exhaust a valid user's target bucket.
  app.use(`${basePath}/*`, async (c, next) => {
    if (
      c.req.method !== "OPTIONS" &&
      options.authenticate &&
      !(await options.authenticate(c))
    ) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  app.use(`${basePath}/*`, rateLimit);

  // Handle all HTTP methods for the proxy
  app.all(`${basePath}/*`, async (c) => {
    try {
      const targetUrl = c.req.header("X-Target-URL");

      if (!targetUrl) {
        return c.json(
          {
            error: "X-Target-URL header is required",
            usage:
              "Set X-Target-URL header to the MCP server URL you want to proxy to",
          },
          400
        );
      }

      if (
        !(await isSafeProxyTarget(targetUrl, options.allowLoopback ?? false))
      ) {
        return c.json(
          {
            error: "Invalid target URL",
            details: "Target is not allowed by the proxy network policy",
          },
          403
        );
      }

      // Optional request validation
      if (options.validateRequest) {
        const isValid = await options.validateRequest(targetUrl, c);
        if (!isValid) {
          return c.json(
            {
              error: "Invalid target URL",
              details: "The requested target URL is not allowed",
            },
            403
          );
        }
      }

      // Validate target URL format
      try {
        new URL(targetUrl);
      } catch {
        return c.json(
          {
            error: "Invalid target URL format",
            details: "The X-Target-URL must be a valid HTTP/HTTPS URL",
          },
          400
        );
      }

      // Forward the request to the target MCP server
      const method = c.req.method;
      const headers: Record<string, string> = {};

      // Copy relevant headers, stripping proxy/infrastructure headers that would
      // confuse the target (e.g. X-Forwarded-Host from our own chain causes the
      // gateway to resolve the wrong hostname and return 404).
      const requestHeaders = c.req.header();
      for (const [key, value] of Object.entries(requestHeaders)) {
        const lowerKey = key.toLowerCase();
        if (
          !lowerKey.startsWith("x-proxy-") &&
          !lowerKey.startsWith("x-target-") &&
          !lowerKey.startsWith("x-mcp-") &&
          !lowerKey.startsWith("x-forwarded-") &&
          !lowerKey.startsWith("cf-") &&
          lowerKey !== "x-original-host" &&
          lowerKey !== "host" &&
          lowerKey !== "origin" &&
          lowerKey !== "referer" &&
          lowerKey !== "cookie" &&
          lowerKey !== "proxy-authorization" &&
          lowerKey !== "accept-encoding" &&
          lowerKey !== "cdn-loop" &&
          !lowerKey.startsWith("sec-fetch-")
        ) {
          headers[key] = value;
        }
      }

      // Explicitly request uncompressed response to avoid encoding issues
      headers["Accept-Encoding"] = "identity";

      // Get request body for POST/PUT/PATCH methods
      // IMPORTANT: Create a stable copy of the body bytes using .slice() to prevent
      // ArrayBuffer detachment issues. Node.js undici can detach the underlying
      // ArrayBuffer during fetch operations, especially with redirects.
      const body =
        method !== "GET" && method !== "HEAD"
          ? new Uint8Array(await c.req.arrayBuffer()).slice()
          : undefined;

      let currentUrl = targetUrl;
      let currentMethod = method;
      let currentBody = body;

      // Follow a bounded redirect chain manually so every destination passes
      // the network policy and request bytes are never reused after detachment.
      for (let redirectCount = 0; ; redirectCount += 1) {
        const response = await fetch(currentUrl, {
          method: currentMethod,
          headers,
          body: currentBody,
          redirect: "manual",
        });
        const location = response.headers.get("location");
        if (!(response.status >= 300 && response.status < 400 && location)) {
          return proxyResponse(response);
        }
        if (redirectCount >= MAX_REDIRECTS) {
          return c.json({ error: "Too many upstream redirects" }, 502);
        }

        const redirectUrl = new URL(location, currentUrl);
        if (
          !(await isSafeProxyTarget(
            redirectUrl.toString(),
            options.allowLoopback ?? false
          )) ||
          (options.validateRequest &&
            !(await options.validateRequest(redirectUrl.toString(), c)))
        ) {
          return c.json({ error: "Redirect target is not allowed" }, 403);
        }
        if (redirectUrl.origin !== new URL(currentUrl).origin) {
          deleteHeader(headers, "authorization");
          deleteHeader(headers, "proxy-authorization");
        }
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) &&
            currentMethod === "POST")
        ) {
          currentMethod = "GET";
          currentBody = undefined;
          deleteHeader(headers, "content-type");
          deleteHeader(headers, "content-length");
        }
        currentUrl = redirectUrl.toString();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      // Get targetUrl for better error logging
      const targetUrl = c.req.header("X-Target-URL");

      // Check if this is a connection refused error (common when a stored server isn't running)
      const isConnectionRefused =
        error instanceof Error &&
        (error.message.includes("ECONNREFUSED") ||
          error.message.includes("fetch failed"));

      if (isConnectionRefused) {
        // This is expected when reconnecting to a stored server that's not running
        // Log as a warning instead of error, without stack trace
        console.warn(
          `[MCP Proxy] Connection refused to ${targetUrl || "unknown target"} - server may not be running`
        );
      } else {
        // Log other errors with full details
        console.error(
          "[MCP Proxy] Request failed:",
          message,
          "\nTarget URL:",
          targetUrl || "unknown",
          "\nError:",
          error
        );
      }

      return c.json(
        {
          error: "Proxy request failed",
          details: message,
          targetUrl: targetUrl || "unknown",
        },
        500
      );
    }
  });
}

function createCorsOriginResolver(
  allowedOrigins: readonly string[] | undefined
): "*" | ((origin: string) => string) {
  if (allowedOrigins === undefined) return "*";
  const origins = new Set(allowedOrigins.map(normalizeOrigin));
  return (origin: string) => {
    try {
      const normalized = normalizeOrigin(origin);
      return origins.has(normalized) ? normalized : "";
    } catch {
      return "";
    }
  };
}

function normalizeOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`MCP proxy allowed origin must be an origin: ${origin}`);
  }
  return url.origin;
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) delete headers[key];
  }
}

async function proxyResponse(response: Response): Promise<Response> {
  // Node.js fetch() auto-decompresses the body but preserves these upstream
  // headers, so they cannot be forwarded with the decoded bytes.
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey !== "content-encoding" &&
      lowerKey !== "transfer-encoding" &&
      lowerKey !== "content-length" &&
      lowerKey !== "set-cookie"
    ) {
      responseHeaders[key] = value;
    }
  });

  const isTrueStream = isOpenEndedSseResponse(
    response.headers.get("content-type") || "",
    response.headers.get("content-length")
  );
  if (isTrueStream) {
    // Railway's edge and other reverse proxies may buffer an otherwise valid
    // SSE response until it closes. MCP v2 subscriptions are intentionally
    // long-lived, so that turns the immediate subscription acknowledgement
    // into a connection timeout. Explicitly opt this response out of proxy
    // buffering while preserving the upstream cache policy.
    responseHeaders["x-accel-buffering"] = "no";
    responseHeaders["cache-control"] ??= "no-cache, no-transform";
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  }

  // Fetch forbids a body for null-body statuses. Passing even a zero-byte
  // ArrayBuffer to Response throws, which turns normal MCP 204 polling
  // responses into proxy 500s.
  if ([204, 205, 304].includes(response.status)) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  }

  const bodyBuffer = await response.arrayBuffer();
  responseHeaders["Content-Length"] = String(bodyBuffer.byteLength);
  return new Response(bodyBuffer, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
