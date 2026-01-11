/**
 * OAuth Proxy Routes
 *
 * Provides CORS-free OAuth flow for browser clients by proxying OAuth requests.
 *
 * This middleware handles:
 * - OAuth metadata discovery (/.well-known/ endpoints)
 * - Token exchange requests (/token endpoints)
 * - Dynamic client registration (/register endpoints)
 * - Authorization requests (/authorize endpoints)
 *
 * @module oauth-proxy
 */

import type { Context, Hono } from "hono";
import { cors } from "hono/cors";

/**
 * Options for configuring the OAuth proxy
 */
export interface OAuthProxyOptions {
  /**
   * Base path for OAuth proxy routes
   * @default "/oauth"
   */
  basePath?: string;

  /**
   * Enable request logging
   * @default true
   */
  enableLogging?: boolean;

  /**
   * Optional authentication function to validate requests
   * Return true to allow the request, false to reject with 401
   */
  authenticate?: (c: Context) => Promise<boolean> | boolean;

  /**
   * Optional validator to check if target URL is allowed
   * Return true to allow, false to reject with 403
   */
  validateTarget?: (
    targetUrl: string,
    c: Context
  ) => Promise<boolean> | boolean;
}

/**
 * Mount OAuth proxy routes on a Hono app
 *
 * This creates endpoints for proxying OAuth requests to bypass CORS restrictions.
 *
 * Creates the following routes:
 * - POST /oauth/proxy - General OAuth request proxy
 * - GET /oauth/metadata - OAuth metadata discovery proxy
 *
 * @param app - Hono application instance
 * @param options - Configuration options for the proxy
 *
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { mountOAuthProxy } from "mcp-use/server";
 *
 * const app = new Hono();
 *
 * // Basic usage
 * mountOAuthProxy(app);
 *
 * // With custom path
 * mountOAuthProxy(app, {
 *   basePath: "/inspector/api/oauth"
 * });
 * ```
 */
export function mountOAuthProxy(
  app: Hono,
  options: OAuthProxyOptions = {}
): void {
  const {
    basePath = "/oauth",
    enableLogging = true,
    authenticate,
    validateTarget,
  } = options;

  // Enable CORS for all OAuth proxy routes
  app.use(
    `${basePath}/*`,
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["*"],
      exposeHeaders: ["*"],
      maxAge: 86400,
    })
  );

  /**
   * OAuth Metadata Discovery Proxy
   * GET /oauth/metadata?url=<encoded_metadata_url>
   *
   * Proxies requests to OAuth metadata endpoints (/.well-known/*) to bypass CORS.
   */
  app.get(`${basePath}/metadata`, async (c: Context) => {
    try {
      // Optional authentication
      if (authenticate) {
        const isAuthenticated = await authenticate(c);
        if (!isAuthenticated) {
          return c.json({ error: "Unauthorized" }, 401);
        }
      }

      const url = c.req.query("url");
      if (!url) {
        return c.json({ error: "Missing url parameter" }, 400);
      }

      // Validate URL format
      let metadataUrl: URL;
      try {
        metadataUrl = new URL(url);
        if (
          metadataUrl.protocol !== "https:" &&
          metadataUrl.protocol !== "http:"
        ) {
          return c.json({ error: "Invalid protocol" }, 400);
        }
      } catch {
        return c.json({ error: "Invalid URL format" }, 400);
      }

      // Optional target validation
      if (validateTarget) {
        const isValid = await validateTarget(url, c);
        if (!isValid) {
          return c.json({ error: "Target URL not allowed" }, 403);
        }
      }

      if (enableLogging) {
        console.log(`[OAuth Proxy] Fetching metadata: ${url}`);
      }

      // Fetch OAuth metadata from the server
      const response = await fetch(metadataUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "mcp-use/1.0",
        },
      });

      if (!response.ok) {
        if (enableLogging) {
          console.error(
            `[OAuth Proxy] Metadata fetch failed: ${response.status} ${response.statusText}`
          );
        }
        return c.json(
          {
            error: `Failed to fetch OAuth metadata: ${response.status} ${response.statusText}`,
          },
          response.status as any
        );
      }

      let metadata = await response.json();

      // If this is an oauth-protected-resource response and we're using MCP proxy,
      // rewrite the resource field to match the connection URL (MCP proxy)
      // The connection URL can be inferred from the OAuth proxy base path
      // e.g., /inspector/api/oauth -> /inspector/api/proxy
      if (metadata.resource && metadata.authorization_servers) {
        // Check if request includes X-Connection-URL header (set by client when using MCP proxy)
        let connectionUrl = c.req.header("X-Connection-URL");

        // If not provided, infer from OAuth proxy base path
        // OAuth proxy at /inspector/api/oauth -> MCP proxy at /inspector/api/proxy
        if (!connectionUrl) {
          const requestUrl = new URL(c.req.url);

          // Detect the actual protocol the client is using (may be different from internal request)
          // Check forwarded headers in order of preference
          let clientProtocol = requestUrl.protocol.replace(":", "");

          // 1. Check X-Forwarded-Proto (most common, set by most proxies)
          const xForwardedProto = c.req.header("X-Forwarded-Proto");
          if (xForwardedProto) {
            clientProtocol = xForwardedProto.split(",")[0].trim();
          }

          // 2. Check X-Forwarded-Scheme (alternative header)
          const xForwardedScheme = c.req.header("X-Forwarded-Scheme");
          if (!xForwardedProto && xForwardedScheme) {
            clientProtocol = xForwardedScheme.trim();
          }

          // 3. Check Forwarded header (RFC 7239)
          const forwarded = c.req.header("Forwarded");
          if (!xForwardedProto && !xForwardedScheme && forwarded) {
            const protoMatch = forwarded.match(/proto=([^;,\s]+)/i);
            if (protoMatch) {
              clientProtocol = protoMatch[1];
            }
          }

          if (enableLogging) {
            console.log(
              `[OAuth Proxy] Detected protocol: ${clientProtocol} (original: ${requestUrl.protocol})`
            );
          }

          // Extract base path before /oauth
          const pathParts = requestUrl.pathname.split("/");
          const oauthIndex = pathParts.findIndex((part) => part === "oauth");
          if (oauthIndex > 0) {
            const basePath = pathParts.slice(0, oauthIndex).join("/");
            // Construct connection URL with the correct protocol
            const host = requestUrl.host;
            connectionUrl = `${clientProtocol}://${host}${basePath}/proxy`;
          }
        }

        if (connectionUrl) {
          // Rewrite resource to match the connection URL (MCP proxy URL)
          // This allows SDK validation to pass when connecting through proxy
          metadata = {
            ...metadata,
            resource: connectionUrl,
          };
          if (enableLogging) {
            console.log(
              `[OAuth Proxy] Rewrote resource field to match connection URL: ${connectionUrl}`
            );
          }
        }
      }

      return c.json(metadata);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (enableLogging) {
        console.error("[OAuth Proxy] Metadata error:", message);
      }
      return c.json(
        {
          error: "OAuth metadata proxy failed",
          details: message,
        },
        500
      );
    }
  });

  /**
   * General OAuth Request Proxy
   * POST /oauth/proxy
   *
   * Proxies OAuth requests (token exchange, registration, etc.) to bypass CORS.
   * Request body: { url: string, method?: string, body?: object, headers?: object }
   */
  app.post(`${basePath}/proxy`, async (c: Context) => {
    try {
      // Optional authentication
      if (authenticate) {
        const isAuthenticated = await authenticate(c);
        if (!isAuthenticated) {
          return c.json({ error: "Unauthorized" }, 401);
        }
      }

      const {
        url,
        method = "GET",
        body,
        headers: customHeaders,
      } = await c.req.json();

      if (!url) {
        return c.json({ error: "Missing url parameter" }, 400);
      }

      // Validate URL format
      let targetUrl: URL;
      try {
        targetUrl = new URL(url);
        if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
          return c.json({ error: "Invalid protocol" }, 400);
        }
      } catch {
        return c.json({ error: "Invalid URL format" }, 400);
      }

      // Optional target validation
      if (validateTarget) {
        const isValid = await validateTarget(url, c);
        if (!isValid) {
          return c.json({ error: "Target URL not allowed" }, 403);
        }
      }

      if (enableLogging) {
        console.log(`[OAuth Proxy] ${method} ${url}`);
      }

      // Build request headers
      const requestHeaders: Record<string, string> = {
        "User-Agent": "mcp-use/1.0",
        ...customHeaders,
      };

      // Determine content type from custom headers or default to JSON
      const contentType =
        customHeaders?.["Content-Type"] || customHeaders?.["content-type"];
      const isFormUrlEncoded = contentType?.includes(
        "application/x-www-form-urlencoded"
      );

      if (method === "POST" && body && !contentType) {
        requestHeaders["Content-Type"] = "application/json";
      }

      // Make request to target server
      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
      };

      if (method === "POST" && body) {
        if (isFormUrlEncoded && typeof body === "object") {
          // Convert object to URL-encoded string
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(body)) {
            params.append(key, String(value));
          }
          fetchOptions.body = params.toString();
        } else if (typeof body === "string") {
          // Body is already a string, use as-is
          fetchOptions.body = body;
        } else {
          // Body is an object, stringify it
          fetchOptions.body = JSON.stringify(body);
        }
      }

      const response = await fetch(targetUrl.toString(), fetchOptions);

      // Capture ALL response headers (no CORS restrictions on backend)
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      let responseBody: any = null;
      const contentTypeHeader = headers["content-type"] || "";

      // Handle different response types
      if (contentTypeHeader.includes("application/json")) {
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }
      } else {
        try {
          responseBody = await response.text();
        } catch {
          responseBody = null;
        }
      }

      // Return full response with headers
      return c.json({
        status: response.status,
        statusText: response.statusText,
        headers,
        body: responseBody,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (enableLogging) {
        console.error("[OAuth Proxy] Request error:", message);
      }
      return c.json(
        {
          error: "OAuth proxy request failed",
          details: message,
        },
        500
      );
    }
  });

  if (enableLogging) {
    console.log(
      `[OAuth Proxy] Mounted OAuth proxy routes at ${basePath}/metadata and ${basePath}/proxy`
    );
  }
}
