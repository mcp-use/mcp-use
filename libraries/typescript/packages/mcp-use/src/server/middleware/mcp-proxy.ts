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

  // CRITICAL: Enable CORS and expose all headers for FastMCP session management
  // The Mcp-Session-Id header MUST be exposed for the browser to read it
  app.use(
    `${basePath}/*`,
    cors({
      origin: "*",
      exposeHeaders: ["*"], // Expose all headers including Mcp-Session-Id for FastMCP
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

      // Get target URL from query parameter or header
      // IMPORTANT: Query parameter takes precedence because it's used for OAuth discovery
      // where we encode the full target path. The SDK might still include X-Target-URL
      // header from the transport config, but we need to use the query param for OAuth.
      const url = new URL(c.req.url);
      const targetFromQuery = url.searchParams.get("__mcp_target");
      let targetUrl: string | undefined;

      if (targetFromQuery) {
        // OAuth discovery mode: construct full URL from target origin + request path
        // e.g., __mcp_target=https://mcp.vercel.com + /.well-known/oauth-protected-resource
        const requestPath = url.pathname.replace(basePath, "");
        targetUrl = targetFromQuery + requestPath;
      } else {
        // Regular MCP proxy mode: use X-Target-URL header
        targetUrl = c.req.header("X-Target-URL");
      }

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

      // Check if this is an OAuth discovery response that needs resource field rewriting
      // The SDK validates that the resource field matches the connection URL for security
      // We need to rewrite the resource to match the proxy URL, but keep authorization_servers
      // pointing to the original OAuth server (the fetch interceptor will route those)
      const contentType = response.headers.get("content-type") || "";
      const isOAuthDiscovery =
        url.pathname.includes("/.well-known/oauth") &&
        contentType.includes("application/json");

      if (isOAuthDiscovery && response.body) {
        // Read and parse the response body
        const bodyText = await response.text();
        try {
          const bodyJson = JSON.parse(bodyText);
          const proxyOrigin = new URL(c.req.url).origin;

          // Rewrite the resource field to match the proxy URL
          // The SDK validates that the resource matches the URL it connected to
          // Without this, the SDK will reject the OAuth response as a security measure
          if (bodyJson.resource) {
            bodyJson.resource = `${proxyOrigin}${basePath}`;
          }

          // DO NOT rewrite authorization_servers - keep them pointing to original OAuth server
          // The browser's fetch interceptor will route requests to those URLs through the OAuth proxy
          // DO NOT rewrite token_endpoint or registration_endpoint - same reason
          // DO NOT rewrite authorization_endpoint - browser needs to redirect there directly

          return new Response(JSON.stringify(bodyJson), {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          });
        } catch {
          // If parsing fails, return original body
          return new Response(bodyText, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          });
        }
      }

      // Return the proxied response unchanged for non-OAuth discovery responses
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
