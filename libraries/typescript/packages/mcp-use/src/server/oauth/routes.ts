/**
 * OAuth Routes
 *
 * Sets up OAuth 2.0 endpoints based on the provider's mode:
 *
 * **Direct Mode** (e.g., WorkOS):
 * - Clients communicate directly with the OAuth provider
 * - MCP server only provides metadata endpoints for discovery
 * - No proxying of OAuth requests
 *
 * **Proxy Mode** (legacy):
 * - MCP server proxies OAuth requests to the provider
 * - Provides /authorize and /token endpoints
 */

import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import type { OAuthProvider } from "./providers/types.js";

/**
 * Setup OAuth routes on the Hono app
 *
 * In direct mode (e.g., WorkOS), creates:
 * - GET /.well-known/oauth-authorization-server - Proxies provider's OAuth metadata
 * - GET /.well-known/oauth-protected-resource - Protected resource metadata
 *
 * In proxy mode (legacy), also creates:
 * - GET/POST /authorize - Authorization endpoint
 * - POST /token - Token exchange endpoint
 *
 * @param app - The Hono application instance
 * @param provider - The OAuth provider
 * @param baseUrl - The base URL of this server (for metadata)
 */
export function setupOAuthRoutes(
  app: Hono,
  provider: OAuthProvider,
  baseUrl: string
): void {
  const mode = provider.getMode?.() || "proxy"; // Default to proxy for backward compatibility

  // Enable CORS for all OAuth-related endpoints
  // This is required for browser-based MCP clients to discover OAuth metadata
  app.use(
    "/.well-known/*",
    cors({
      origin: "*", // Allow all origins for metadata discovery
      allowMethods: ["GET", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      exposeHeaders: ["Content-Type"],
      maxAge: 86400, // Cache preflight for 24 hours
    })
  );

  // Also enable CORS on OAuth endpoints in proxy mode
  if (mode === "proxy") {
    app.use(
      "/authorize",
      cors({
        origin: "*",
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
        maxAge: 86400,
      })
    );
    app.use(
      "/token",
      cors({
        origin: "*",
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
        maxAge: 86400,
      })
    );
  }

  // Only set up proxy endpoints in proxy mode
  if (mode === "proxy") {
    /**
     * Authorization endpoint - redirects to provider's auth endpoint
     * Supports both GET and POST methods as per OAuth 2.0 spec
     */
    const handleAuthorize = async (c: Context) => {
      const params =
        c.req.method === "POST" ? await c.req.parseBody() : c.req.query();

      // Required OAuth parameters
      const clientId = params.client_id;
      const redirectUri = params.redirect_uri;
      const responseType = params.response_type;
      const codeChallenge = params.code_challenge;
      const codeChallengeMethod = params.code_challenge_method;

      // Optional parameters
      const state = params.state;
      const scope = params.scope;
      const audience = params.audience;

      // Validate required parameters
      if (!clientId || !redirectUri || !responseType || !codeChallenge) {
        return c.json(
          {
            error: "invalid_request",
            error_description: "Missing required parameters",
          },
          400
        );
      }

      // Build provider authorization URL
      const authUrl = new URL(provider.getAuthEndpoint());
      authUrl.searchParams.set("client_id", clientId as string);
      authUrl.searchParams.set("redirect_uri", redirectUri as string);
      authUrl.searchParams.set("response_type", responseType as string);
      authUrl.searchParams.set("code_challenge", codeChallenge as string);
      authUrl.searchParams.set(
        "code_challenge_method",
        (codeChallengeMethod as string) || "S256"
      );

      if (state) authUrl.searchParams.set("state", state as string);
      if (scope) authUrl.searchParams.set("scope", scope as string);
      if (audience) authUrl.searchParams.set("audience", audience as string);

      // Redirect to provider
      return c.redirect(authUrl.toString(), 302);
    };

    app.get("/authorize", handleAuthorize);
    app.post("/authorize", handleAuthorize);

    /**
     * Token endpoint - proxies to provider's token exchange
     */
    app.post("/token", async (c: Context) => {
      try {
        const body = await c.req.parseBody();

        // Forward the request to provider
        const response = await fetch(provider.getTokenEndpoint(), {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(body as Record<string, string>).toString(),
        });

        const data = await response.json();

        if (!response.ok) {
          return c.json(data, response.status as any);
        }

        return c.json(data);
      } catch (error) {
        return c.json(
          {
            error: "server_error",
            error_description: `Token exchange failed: ${error}`,
          },
          500
        );
      }
    });
  }

  /**
   * OAuth Authorization Server Metadata
   * As per RFC 8414: https://tools.ietf.org/html/rfc8414
   *
   * In direct mode: Fetches and returns metadata from the provider
   * In proxy mode: Returns MCP server's proxy endpoints
   */
  const handleAuthorizationServerMetadata = async (c: Context) => {
    const requestPath = new URL(c.req.url).pathname;
    console.log(`[OAuth] Metadata request: ${requestPath} (mode: ${mode})`);

    if (mode === "direct") {
      // Direct mode: Fetch metadata from provider
      try {
        const metadataUrl = `${provider.getIssuer()}/.well-known/oauth-authorization-server`;
        console.log(`[OAuth] Fetching metadata from provider: ${metadataUrl}`);
        const response = await fetch(metadataUrl);

        if (!response.ok) {
          console.error(
            `[OAuth] Failed to fetch provider metadata: ${response.status}`
          );
          return c.json(
            {
              error: "server_error",
              error_description: `Failed to fetch provider metadata: ${response.status}`,
            },
            500
          );
        }

        const metadata = await response.json();

        // Check if provider has a pre-registered client (stored in provider config)
        // If so, remove registration_endpoint to prevent clients from using DCR
        const hasRegisteredClient =
          provider.getRegistrationEndpoint &&
          (provider as any).config?.clientId;

        if (hasRegisteredClient) {
          console.log(
            `[OAuth] Provider has pre-registered client - removing DCR endpoint`
          );
          // Remove registration_endpoint to signal that DCR is not available
          delete metadata.registration_endpoint;
        }

        console.log(`[OAuth] Provider metadata retrieved successfully`);
        console.log(`[OAuth]   - Issuer: ${metadata.issuer}`);
        console.log(
          `[OAuth]   - Registration endpoint: ${metadata.registration_endpoint || "not available (using pre-registered client)"}`
        );
        return c.json(metadata);
      } catch (error) {
        console.error(`[OAuth] Error fetching provider metadata:`, error);
        return c.json(
          {
            error: "server_error",
            error_description: `Failed to fetch provider metadata: ${error}`,
          },
          500
        );
      }
    } else {
      // Proxy mode: Return MCP server endpoints
      console.log(`[OAuth] Returning proxy mode metadata`);
      return c.json({
        issuer: provider.getIssuer(),
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        response_types_supported: ["code"],
        grant_types_supported: provider.getGrantTypesSupported(),
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: [
          "client_secret_post",
          "client_secret_basic",
          "none",
        ],
        scopes_supported: provider.getScopesSupported(),
      });
    }
  };

  // Register the handler for both OAuth and OpenID Connect discovery endpoints
  app.get(
    "/.well-known/oauth-authorization-server",
    handleAuthorizationServerMetadata
  );
  app.get(
    "/.well-known/openid-configuration",
    handleAuthorizationServerMetadata
  );

  /**
   * OAuth Protected Resource Metadata
   * As per RFC 9728: https://tools.ietf.org/html/rfc9728
   *
   * This tells MCP clients which authorization server(s) to use.
   * In both modes, this points to the actual OAuth provider (not the MCP server).
   */
  app.get("/.well-known/oauth-protected-resource", (c: Context) => {
    console.log(`[OAuth] Protected resource metadata request (mode: ${mode})`);
    console.log(`[OAuth]   - Resource: ${baseUrl}`);
    console.log(`[OAuth]   - Authorization server: ${provider.getIssuer()}`);

    return c.json({
      resource: baseUrl,
      authorization_servers: [provider.getIssuer()],
      bearer_methods_supported: ["header"],
      resource_documentation:
        mode === "direct"
          ? "This resource uses direct OAuth flow. Clients communicate directly with the authorization server."
          : undefined,
    });
  });

  // Legacy endpoint for backward compatibility
  app.get("/.well-known/oauth-protected-resource/mcp", (c: Context) => {
    return c.json({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [provider.getIssuer()],
      bearer_methods_supported: ["header"],
    });
  });
}
