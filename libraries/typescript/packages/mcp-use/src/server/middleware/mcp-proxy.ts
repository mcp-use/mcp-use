/**
 * MCP Proxy Middleware for Hono
 *
 * Provides a CORS proxy for browser-based MCP clients to connect to remote MCP servers
 * that don't support CORS or require server-side forwarding.
 *
 * @module mcp-proxy
 */

import type { Hono, Context } from "hono";
import { logger } from "hono/logger";

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
 * import { mountMcpProxy } from "mcp-use/server";
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

      // Get target URL from header
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

      // Copy relevant headers, excluding proxy-specific ones and encoding preferences
      const requestHeaders = c.req.header();
      for (const [key, value] of Object.entries(requestHeaders)) {
        const lowerKey = key.toLowerCase();
        if (
          !lowerKey.startsWith("x-proxy-") &&
          !lowerKey.startsWith("x-target-") &&
          lowerKey !== "host" &&
          lowerKey !== "accept-encoding"
        ) {
          // Don't forward accept-encoding to prevent compression issues
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
      const body =
        method !== "GET" && method !== "HEAD"
          ? await c.req.arrayBuffer()
          : undefined;

      // Forward request to target server
      const response = await fetch(targetUrl, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
      });

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

      // Return the proxied response
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[MCP Proxy] Request failed:", message, error);
      return c.json(
        {
          error: "Proxy request failed",
          details: message,
        },
        500
      );
    }
  });
}
