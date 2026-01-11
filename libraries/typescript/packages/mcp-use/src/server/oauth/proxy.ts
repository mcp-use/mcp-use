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

      let response: Response | null = null;
      let discoveredFromWWWAuth = false;

      // FIRST: Try to discover metadata URL from WWW-Authenticate header
      // This is the authoritative source per OAuth spec and handles non-standard paths
      // ONLY apply this for oauth-protected-resource requests (not oauth-authorization-server)
      if (url.includes("/.well-known/oauth-protected-resource")) {
        const mcpServerUrl = c.req.query("mcp_url");

        if (mcpServerUrl) {
          try {
            if (enableLogging) {
              console.log(
                `[OAuth Proxy] Attempting metadata discovery from WWW-Authenticate header for: ${mcpServerUrl}`
              );
            }

            // Make a request to the MCP endpoint to get WWW-Authenticate header
            const mcpResponse = await fetch(mcpServerUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              // Send minimal MCP request to trigger 401 with WWW-Authenticate
              body: JSON.stringify({ jsonrpc: "2.0", method: "initialize" }),
            });

            // Extract WWW-Authenticate header
            const wwwAuth = mcpResponse.headers.get("WWW-Authenticate");
            if (wwwAuth) {
              if (enableLogging) {
                console.log(
                  `[OAuth Proxy] WWW-Authenticate header: ${wwwAuth}`
                );
              }

              // Parse resource_metadata from header
              // Format: Bearer error="...", resource_metadata="https://..."
              const resourceMetadataMatch = wwwAuth.match(
                /resource_metadata="([^"]+)"/
              );

              if (resourceMetadataMatch && resourceMetadataMatch[1]) {
                const discoveredMetadataUrl = resourceMetadataMatch[1];
                if (enableLogging) {
                  console.log(
                    `[OAuth Proxy] Discovered metadata URL from WWW-Authenticate: ${discoveredMetadataUrl}`
                  );
                }

                // Fetch from the discovered URL
                response = await fetch(discoveredMetadataUrl, {
                  method: "GET",
                  headers: {
                    Accept: "application/json",
                    "User-Agent": "mcp-use/1.0",
                  },
                });

                if (response.ok) {
                  discoveredFromWWWAuth = true;
                  if (enableLogging) {
                    console.log(
                      `[OAuth Proxy] Successfully fetched metadata from discovered URL`
                    );
                  }
                }
              }
            }
          } catch (discoveryError) {
            if (enableLogging) {
              console.log(
                `[OAuth Proxy] WWW-Authenticate discovery failed, falling back to standard path:`,
                discoveryError instanceof Error
                  ? discoveryError.message
                  : discoveryError
              );
            }
            // Continue to fallback
          }
        }
      }

      // FALLBACK: Try the standard .well-known path if discovery failed
      if (!response || !response.ok) {
        if (enableLogging && !discoveredFromWWWAuth) {
          console.log(`[OAuth Proxy] Trying standard metadata path: ${url}`);
        }

        response = await fetch(metadataUrl.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "mcp-use/1.0",
          },
        });
      }

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
      // we need to temporarily rewrite the resource field to pass SDK validation.
      // The browser fetch interceptor will rewrite it back to the actual resource
      // when making the authorization request to the OAuth server.
      if (metadata.resource && metadata.authorization_servers) {
        // Check if request includes X-Connection-URL header (set by client when using MCP proxy)
        let connectionUrl = c.req.header("X-Connection-URL");

        // If not provided, infer from OAuth proxy base path
        // OAuth proxy at /inspector/api/oauth -> MCP proxy at /inspector/api/proxy
        if (!connectionUrl) {
          const requestUrl = new URL(c.req.url);

          // Detect the actual protocol the client is using
          let clientProtocol = requestUrl.protocol.replace(":", "");
          const xForwardedProto = c.req.header("X-Forwarded-Proto");
          if (xForwardedProto) {
            clientProtocol = xForwardedProto.split(",")[0].trim();
          }

          // Detect the actual host the client is using
          let clientHost = requestUrl.host;
          const xForwardedHost = c.req.header("X-Forwarded-Host");
          if (xForwardedHost) {
            clientHost = xForwardedHost.split(",")[0].trim();
          }

          // Extract base path before /oauth
          const pathParts = requestUrl.pathname.split("/");
          const oauthIndex = pathParts.findIndex((part) => part === "oauth");
          if (oauthIndex > 0) {
            const basePath = pathParts.slice(0, oauthIndex).join("/");
            connectionUrl = `${clientProtocol}://${clientHost}${basePath}/proxy`;
          }
        }

        if (connectionUrl) {
          // Store the original resource URL in a custom field
          metadata = {
            ...metadata,
            resource: connectionUrl, // SDK validation requires this to match connection URL
            _original_resource: metadata.resource, // Store original for client to use in OAuth request
          };
          if (enableLogging) {
            console.log(
              `[OAuth Proxy] Rewrote resource field to ${connectionUrl} for SDK validation (original: ${metadata._original_resource})`
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
