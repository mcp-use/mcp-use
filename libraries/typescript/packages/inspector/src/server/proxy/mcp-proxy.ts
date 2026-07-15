/**
 * MCP Proxy Middleware for Hono
 *
 * Provides a CORS proxy for browser-based MCP clients to connect to remote MCP servers
 * that don't support CORS or require server-side forwarding.
 *
 * @module mcp-proxy
 */

import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
// ponytail: vendored from mcp-use/src/server/middleware/mcp-proxy.ts — keep in sync manually.
import { isSafeProxyTarget } from "./oauth-proxy.js";

/**
 * Options for configuring the MCP proxy middleware
 */
export interface McpProxyOptions {
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

  // CRITICAL: Enable CORS and expose all headers for FastMCP session management
  // The Mcp-Session-Id header MUST be exposed for the browser to read it
  // NOTE: Authorization must be listed explicitly — the wildcard * does NOT cover it per the Fetch spec.
  app.use(
    `${basePath}/*`,
    cors({
      origin: "*",
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "Accept",
        "X-Target-URL",
        "X-MCP-Target",
        "Mcp-Session-Id",
        "mcp-session-id",
        "mcp-protocol-version",
        "X-Server-Id",
        "X-Requested-With",
      ],
      exposeHeaders: ["*"],
    })
  );

  // Apply logger middleware to proxy routes
  if (enableLogging) {
    app.use(`${basePath}/*`, logger());
  }

  // Handle all HTTP methods for the proxy
  app.all(`${basePath}/*`, async (c) => {
    try {
      // Optional authentication
      if (options.authenticate) {
        const isAuthenticated = await options.authenticate(c);
        if (!isAuthenticated) {
          return c.json({ error: "Unauthorized" }, 401);
        }
      }

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
          lowerKey !== "accept-encoding" &&
          lowerKey !== "cdn-loop"
        ) {
          headers[key] = value;
        }
      }

      // Explicitly request uncompressed response to avoid encoding issues
      headers["Accept-Encoding"] = "identity";

      // Set the target URL's host as the Host header
      try {
        const targetUrlObj = new URL(targetUrl);
        headers.Host = targetUrlObj.host;
      } catch {
        return c.json({ error: "Invalid target URL" }, 400);
      }

      // Get request body for POST/PUT/PATCH methods
      // IMPORTANT: Create a stable copy of the body bytes using .slice() to prevent
      // ArrayBuffer detachment issues. Node.js undici can detach the underlying
      // ArrayBuffer during fetch operations, especially with redirects.
      const body =
        method !== "GET" && method !== "HEAD"
          ? new Uint8Array(await c.req.arrayBuffer()).slice()
          : undefined;

      // Forward request to target server
      // Use redirect: 'manual' to handle redirects ourselves, avoiding undici's
      // internal body re-use which can trigger detachment errors.
      const response = await fetch(targetUrl, {
        method,
        headers,
        body,
        redirect: "manual",
      });

      // Handle redirects manually to avoid ArrayBuffer detachment issues in Node.js
      // When undici follows redirects automatically, it tries to re-use the request body,
      // but by that point the ArrayBuffer may be detached, causing "Cannot perform
      // ArrayBuffer.prototype.slice on a detached ArrayBuffer" errors.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location) {
          const redirectUrl = new URL(location, targetUrl).toString();
          if (
            !(await isSafeProxyTarget(
              redirectUrl,
              options.allowLoopback ?? false
            )) ||
            (options.validateRequest &&
              !(await options.validateRequest(redirectUrl, c)))
          ) {
            return c.json({ error: "Redirect target is not allowed" }, 403);
          }
          // For redirects, make a new fetch to the redirect location
          // We can reuse `body` since we created a stable copy with .slice()
          const redirectResponse = await fetch(redirectUrl, {
            method,
            headers,
            body,
            redirect: "manual",
          });

          // Return the redirect response (or follow one more level if needed)
          const redirectHeaders: Record<string, string> = {};
          redirectResponse.headers.forEach((value, key) => {
            const lowerKey = key.toLowerCase();
            if (
              lowerKey !== "content-encoding" &&
              lowerKey !== "transfer-encoding" &&
              lowerKey !== "content-length"
            ) {
              redirectHeaders[key] = value;
            }
          });

          return new Response(redirectResponse.body, {
            status: redirectResponse.status,
            statusText: redirectResponse.statusText,
            headers: redirectHeaders,
          });
        }
      }

      // Forward response headers, excluding problematic encoding headers
      // Node.js fetch() auto-decompresses the body but preserves these headers,
      // which can cause issues when forwarding to the client
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        // Skip compression-related headers that don't match the actual body state
        if (
          lowerKey !== "content-encoding" &&
          lowerKey !== "transfer-encoding" &&
          lowerKey !== "content-length"
        ) {
          responseHeaders[key] = value;
        }
      });

      const contentType = response.headers.get("content-type") || "";

      // For streaming SSE responses (GET without content-length), pass through the body stream.
      // For all other responses, buffer the body and set Content-Length so browsers
      // don't hang waiting for a ReadableStream that may not signal EOF promptly.
      const isSSE = contentType.includes("text/event-stream");
      const isGetRequest = c.req.method === "GET";
      const upstreamContentLength = response.headers.get("content-length");
      const isTrueStream = isSSE && isGetRequest && !upstreamContentLength;

      if (isTrueStream) {
        return new Response(response.body, {
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
