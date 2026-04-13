/**
 * OAuth Routes
 *
 * Sets up OAuth 2.0 endpoints for an MCP server running the DCR-direct flow:
 * - Clients discover the upstream authorization server via `.well-known/*`
 *   passthrough served here.
 * - Clients then authorize, register, and exchange tokens directly against
 *   the upstream. The MCP server itself only validates bearer tokens.
 *
 * The `/authorize` and `/token` handlers are retained (and registered) but
 * dormant in this flow — see the jsdoc on `createAuthorizeHandler` and
 * `createTokenHandler` for details. They're kept here so the forthcoming
 * `oauthProxyProvider` can mount them without re-plumbing CORS or re-writing
 * the forwarding logic.
 */

import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import type { OAuthProvider } from "./providers/types.js";

/**
 * Authorization endpoint handler (proxy-mode legacy).
 *
 * Retained from the original proxy-mode implementation. In the DCR-direct
 * flow, clients fetch the upstream authorize URL via the metadata passthrough
 * below and redirect there themselves — so this handler isn't exercised in
 * normal use. It's exported so the forthcoming `oauthProxyProvider` can mount
 * it on its own routes without rebuilding it. Do not delete without
 * coordinating with that refactor.
 *
 * @param provider - The OAuth provider
 * @returns Hono handler that redirects to the provider's authorize endpoint
 */
export function createAuthorizeHandler(
  provider: OAuthProvider
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
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
}

/**
 * Token endpoint handler (proxy-mode legacy).
 *
 * Retained from the original proxy-mode implementation. In the DCR-direct
 * flow, clients call the upstream token endpoint directly — so this handler
 * isn't exercised in normal use. It's exported so the forthcoming
 * `oauthProxyProvider` can mount it on its own routes without rebuilding it.
 * Do not delete without coordinating with that refactor.
 *
 * @param provider - The OAuth provider
 * @returns Hono handler that forwards form-encoded token exchanges upstream
 */
export function createTokenHandler(
  provider: OAuthProvider
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
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
  };
}

/**
 * Setup OAuth routes on the Hono app (DCR-direct flow)
 *
 * Creates:
 * - GET /.well-known/oauth-authorization-server - Proxies provider's OAuth metadata
 * - GET /.well-known/openid-configuration - Same, under the OIDC discovery URL
 * - GET /.well-known/oauth-protected-resource - Protected resource metadata
 * - GET /.well-known/oauth-protected-resource/mcp - Path-scoped protected
 *   resource metadata per RFC 9728 (says "the /mcp path is the protected
 *   resource"). Not proxy-specific — applies equally to DCR-direct and the
 *   future proxy flow.
 *
 * Also mounts `/authorize` and `/token` handlers. These are dormant in the
 * DCR-direct flow (clients are handed upstream URLs via the `.well-known`
 * passthrough and never reach the MCP server for these routes) but are kept
 * ready for the forthcoming `oauthProxyProvider`.
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

  // CORS for the dormant `/authorize` and `/token` routes. They aren't
  // exercised in the DCR-direct flow, but they need CORS preconfigured so
  // the forthcoming `oauthProxyProvider` can mount them as-is.
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

  // Dormant in DCR-direct (clients reach the upstream directly via metadata
  // passthrough) — retained for the forthcoming `oauthProxyProvider`. See the
  // handler jsdoc above.
  const handleAuthorize = createAuthorizeHandler(provider);
  app.get("/authorize", handleAuthorize);
  app.post("/authorize", handleAuthorize);
  app.post("/token", createTokenHandler(provider));

  /**
   * OAuth Authorization Server Metadata
   * As per RFC 8414: https://tools.ietf.org/html/rfc8414
   *
   * Fetches and returns metadata from the upstream provider so clients
   * discover its authorize/token/register endpoints directly.
   */
  const handleAuthorizationServerMetadata = async (c: Context) => {
    const requestPath = new URL(c.req.url).pathname;
    console.log(`[OAuth] Metadata request: ${requestPath}`);

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

      console.log(`[OAuth] Provider metadata retrieved successfully`);
      console.log(`[OAuth]   - Issuer: ${metadata.issuer}`);
      console.log(
        `[OAuth]   - Registration endpoint: ${metadata.registration_endpoint || "not advertised by provider"}`
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
   * Tells MCP clients which authorization server(s) to use. Points to the
   * actual OAuth provider (not the MCP server).
   */
  app.get("/.well-known/oauth-protected-resource", (c: Context) => {
    console.log(`[OAuth] Protected resource metadata request`);
    console.log(`[OAuth]   - Resource: ${baseUrl}`);
    console.log(`[OAuth]   - Authorization server: ${provider.getIssuer()}`);

    return c.json({
      resource: baseUrl,
      authorization_servers: [provider.getIssuer()],
      scopes_supported: provider.getScopesSupported(),
      bearer_methods_supported: ["header"],
    });
  });

  // Path-scoped protected resource metadata per RFC 9728 — declares that the
  // `/mcp` path specifically is the protected resource. Applies to both the
  // DCR-direct flow and the future proxy flow (not proxy-specific).
  app.get("/.well-known/oauth-protected-resource/mcp", (c: Context) => {
    return c.json({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [provider.getIssuer()],
      scopes_supported: provider.getScopesSupported(),
      bearer_methods_supported: ["header"],
    });
  });
}
