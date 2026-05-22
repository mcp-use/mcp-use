/**
 * OAuth Routes
 *
 * Sets up OAuth 2.0 endpoints for an MCP server. Supports two modes:
 *
 * 1. **DCR-direct mode (OAuthProvider):** Clients discover the upstream
 *    authorization server via `.well-known/*` passthrough and communicate
 *    directly with the upstream for authorize/token/register.
 *
 * 2. **Proxy mode (OAuthProxy):** For providers that don't support DCR
 *    (e.g., Google, GitHub). The MCP server:
 *    - Exposes /register returning the configured clientId
 *    - Redirects /authorize to upstream with extra params
 *    - Forwards /token requests with injected credentials
 *    - Synthesizes `.well-known` metadata pointing to local endpoints
 */

import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { OAuthProvider, OAuthProxy } from "./providers/types.js";

/**
 * Type guard to check if oauth config is a proxy
 */
export function isOAuthProxy(
  oauth: OAuthProvider | OAuthProxy
): oauth is OAuthProxy {
  return (oauth as OAuthProxy).type === "proxy";
}

/**
 * Authorization endpoint handler
 *
 * In DCR-direct mode (OAuthProvider): Dormant — clients reach upstream directly.
 * In proxy mode (OAuthProxy): Active — redirects to upstream with extra params.
 *
 * @param oauth - The OAuth provider or proxy
 * @returns Hono handler that redirects to the upstream authorize endpoint
 */
function createAuthorizeHandler(
  oauth: OAuthProvider | OAuthProxy
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

    // Get authorization endpoint - uniform for both provider and proxy
    const authEndpoint = oauth.getAuthEndpoint();

    // Build provider authorization URL
    const authUrl = new URL(authEndpoint);
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

    if (isOAuthProxy(oauth)) {
      // Override with the configured upstream client_id; the incoming value
      // may be stale DCR cache.
      authUrl.searchParams.set("client_id", oauth.clientId);
      if (oauth.extraAuthorizeParams) {
        for (const [key, value] of Object.entries(oauth.extraAuthorizeParams)) {
          authUrl.searchParams.set(key, value);
        }
      }
    } else {
      authUrl.searchParams.set("client_id", clientId as string);
    }

    // Redirect to provider
    return c.redirect(authUrl.toString(), 302);
  };
}

/**
 * Token endpoint handler
 *
 * In DCR-direct mode (OAuthProvider): Dormant — clients call upstream directly.
 * In proxy mode (OAuthProxy): Active — injects clientId/clientSecret before forwarding.
 *
 * @param oauth - The OAuth provider or proxy
 * @returns Hono handler that forwards form-encoded token exchanges upstream
 */
function createTokenHandler(
  oauth: OAuthProvider | OAuthProxy
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
    try {
      const body = await c.req.parseBody();

      // Get token endpoint - uniform for both provider and proxy
      const tokenEndpoint = oauth.getTokenEndpoint();

      // Build the request body
      const requestBody = new URLSearchParams(body as Record<string, string>);

      // In proxy mode, inject client credentials
      if (isOAuthProxy(oauth)) {
        // Always set client_id (required for all token requests)
        requestBody.set("client_id", oauth.clientId);

        // Add client_secret if configured (for confidential clients)
        if (oauth.clientSecret) {
          requestBody.set("client_secret", oauth.clientSecret);
        }
      }

      // Forward the request to provider. `Accept: application/json` is
      // required for providers that default to form-encoded responses
      // (GitHub's /login/oauth/access_token returns `access_token=...&...`
      // unless JSON is explicitly requested).
      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: requestBody.toString(),
      });

      const contentType = response.headers.get("content-type") ?? "";
      const rawBody = await response.text();
      const data = contentType.includes("application/x-www-form-urlencoded")
        ? Object.fromEntries(new URLSearchParams(rawBody))
        : JSON.parse(rawBody);

      if (!response.ok) {
        return c.json(data, response.status as ContentfulStatusCode);
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
 * Setup OAuth routes on the Hono app
 *
 * **DCR-direct mode (OAuthProvider):**
 * - GET /.well-known/oauth-authorization-server - Proxies provider's OAuth metadata
 * - GET /.well-known/openid-configuration - Same, under the OIDC discovery URL
 * - GET /.well-known/oauth-protected-resource - Protected resource metadata
 * - /authorize and /token are dormant (clients reach upstream directly)
 *
 * **Proxy mode (OAuthProxy):**
 * - POST /register - Returns configured clientId (fake DCR endpoint)
 * - GET/POST /authorize - Redirects to upstream with extra params
 * - POST /token - Forwards with injected credentials
 * - GET /.well-known/* - Synthesized metadata pointing to local endpoints
 *
 * @param rootApp - The underlying Hono instance (un-prefixed root view)
 * @param oauth - The OAuth provider or proxy
 * @param getBaseUrl - Lazy getter for the server base URL. Called per-request so
 *                     callers can register routes before the HTTP listener has
 *                     bound a port (baseUrl is only consumed inside handlers).
 * @param basePath - Optional prefix the server is mounted under (e.g. "/api")
 */
export function setupOAuthRoutes(
  rootApp: Hono,
  oauth: OAuthProvider | OAuthProxy,
  getBaseUrl: () => string,
  basePath: string = ""
): void {
  const proxyMode = isOAuthProxy(oauth);
  // `getBaseUrl()` returns the server origin (no path); `basePath` is the
  // externally-visible prefix the server is mounted under. The combination
  // (resolved lazily inside each handler) is what goes into discovery metadata
  // so clients land on the right paths.
  // - /authorize, /token, /register live under `basePath` — registered on
  //   a `.basePath()` clone so the prefix is prepended automatically.
  // - .well-known/* discovery lives at the host root on `rootApp`. Per
  //   RFC 8414 §3.1, the discovery URL is `<host>/.well-known/<type>` with
  //   the issuer's path appended *after* the well-known segment — not
  //   `<host>/<basePath>/.well-known/...`. Registering on `rootApp` keeps
  //   the well-known endpoints at the literal host root regardless of
  //   `basePath` (unlike `/_mcp-use/*`, which now lives under basePath).
  const app = basePath ? rootApp.basePath(basePath) : rootApp;
  const getPrefixedBaseUrl = () => `${getBaseUrl()}${basePath}`;
  // Enable CORS for all OAuth-related discovery endpoints on rootApp.
  rootApp.use(
    "/.well-known/oauth-*",
    cors({
      origin: "*", // Allow all origins for metadata discovery
      allowMethods: ["GET", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      exposeHeaders: ["Content-Type"],
      maxAge: 86400, // Cache preflight for 24 hours
    })
  );
  rootApp.use(
    "/.well-known/openid-configuration*",
    cors({
      origin: "*",
      allowMethods: ["GET", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      exposeHeaders: ["Content-Type"],
      maxAge: 86400,
    })
  );

  // CORS for /authorize and /token routes
  // In DCR-direct mode: dormant (clients reach upstream directly)
  // In proxy mode: active (handles OAuth flow through the proxy)
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

  // Mount /authorize and /token handlers
  const handleAuthorize = createAuthorizeHandler(oauth);
  app.get("/authorize", handleAuthorize);
  app.post("/authorize", handleAuthorize);
  app.post("/token", createTokenHandler(oauth));

  // In proxy mode, add /register endpoint that returns the configured clientId
  // This allows MCP clients to "register" even though the client is pre-registered
  if (proxyMode) {
    const proxy = oauth as OAuthProxy;

    app.use(
      "/register",
      cors({
        origin: "*",
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
        maxAge: 86400,
      })
    );

    app.post("/register", async (c: Context) => {
      const body = await c.req.json().catch(() => ({}));

      // Return a fake registration response with the configured clientId
      // This satisfies MCP clients that expect DCR to work
      return c.json(
        {
          client_id: proxy.clientId,
          client_name: body.client_name || "MCP Client",
          redirect_uris: body.redirect_uris || [],
          grant_types: oauth.getGrantTypesSupported(),
          response_types: ["code"],
          token_endpoint_auth_method: proxy.clientSecret
            ? "client_secret_post"
            : "none",
        },
        201
      );
    });
  }

  /**
   * OAuth Authorization Server Metadata
   * As per RFC 8414: https://tools.ietf.org/html/rfc8414
   *
   * DCR-direct mode: Fetches and returns metadata from upstream provider.
   * Proxy mode: Synthesizes metadata pointing to local endpoints.
   */
  const handleAuthorizationServerMetadata = async (c: Context) => {
    const requestPath = new URL(c.req.url).pathname;
    console.log(`[OAuth] Metadata request: ${requestPath}`);

    // In proxy mode, synthesize metadata pointing to local endpoints
    if (proxyMode) {
      const proxy = oauth as OAuthProxy;
      console.log(`[OAuth] Returning proxy mode metadata`);

      const prefixedBaseUrl = getPrefixedBaseUrl();
      return c.json({
        issuer: prefixedBaseUrl,
        authorization_endpoint: `${prefixedBaseUrl}/authorize`,
        token_endpoint: `${prefixedBaseUrl}/token`,
        registration_endpoint: `${prefixedBaseUrl}/register`,
        scopes_supported: oauth.getScopesSupported(),
        response_types_supported: ["code"],
        grant_types_supported: oauth.getGrantTypesSupported(),
        token_endpoint_auth_methods_supported: proxy.clientSecret
          ? ["client_secret_post", "none"]
          : ["none"],
        code_challenge_methods_supported: ["S256"],
      });
    }

    // DCR-direct mode: proxy to upstream
    try {
      const issuer = oauth.getIssuer();
      const metadataUrl = `${issuer.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`;
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
        `[OAuth]   - Registration endpoint: ${metadata.registration_endpoint || "not available (using pre-registered client)"}`
      );
      return c.json(metadata);
    } catch (error) {
      return c.json(
        {
          error: "server_error",
          error_description: `Failed to fetch provider metadata: ${error}`,
        },
        500
      );
    }
  };

  // Discovery URLs the SDK probes (see `buildDiscoveryUrls` in
  // @modelcontextprotocol/sdk client/auth.js). The SDK tries the path-aware
  // variant first (well-known segment with the issuer's path appended), then
  // falls back to root. Register both so either probe wins.
  //
  // With `basePath: "/api"` and issuer `http://host/api`:
  //   path-aware: GET /.well-known/oauth-authorization-server/api
  //   root:       GET /.well-known/oauth-authorization-server
  rootApp.get(
    "/.well-known/oauth-authorization-server",
    handleAuthorizationServerMetadata
  );
  rootApp.get(
    "/.well-known/openid-configuration",
    handleAuthorizationServerMetadata
  );
  if (basePath) {
    rootApp.get(
      `/.well-known/oauth-authorization-server${basePath}`,
      handleAuthorizationServerMetadata
    );
    rootApp.get(
      `/.well-known/openid-configuration${basePath}`,
      handleAuthorizationServerMetadata
    );
    // OIDC Discovery 1.0 style — well-known appended after the path.
    rootApp.get(
      `${basePath}/.well-known/openid-configuration`,
      handleAuthorizationServerMetadata
    );
  }

  /**
   * OAuth Protected Resource Metadata
   * As per RFC 9728: https://tools.ietf.org/html/rfc9728
   *
   * DCR-direct mode: Points to the actual OAuth provider.
   * Proxy mode: Points to the local server (which proxies to upstream).
   */
  const handleProtectedResourceMetadata = (c: Context) => {
    const prefixedBaseUrl = getPrefixedBaseUrl();
    const authServer = proxyMode ? prefixedBaseUrl : oauth.getIssuer();
    console.log(`[OAuth] Protected resource metadata request`);
    console.log(`[OAuth]   - Resource: ${prefixedBaseUrl}`);
    console.log(`[OAuth]   - Authorization server: ${authServer}`);
    return c.json({
      resource: prefixedBaseUrl,
      authorization_servers: [authServer],
      scopes_supported: oauth.getScopesSupported(),
      bearer_methods_supported: ["header"],
    });
  };

  const handleProtectedResourceMetadataMcp = (c: Context) => {
    const prefixedBaseUrl = getPrefixedBaseUrl();
    const authServer = proxyMode ? prefixedBaseUrl : oauth.getIssuer();
    return c.json({
      resource: `${prefixedBaseUrl}/mcp`,
      authorization_servers: [authServer],
      scopes_supported: oauth.getScopesSupported(),
      bearer_methods_supported: ["header"],
    });
  };

  rootApp.get(
    "/.well-known/oauth-protected-resource",
    handleProtectedResourceMetadata
  );
  // Path-scoped protected resource metadata per RFC 9728 — declares the MCP
  // endpoint as the protected resource.
  rootApp.get(
    `/.well-known/oauth-protected-resource${basePath}/mcp`,
    handleProtectedResourceMetadataMcp
  );
  if (basePath) {
    // Also expose the basePath-scoped variant without the `/mcp` suffix, in
    // case a client probes the issuer URL (`<host>/<basePath>`) directly.
    rootApp.get(
      `/.well-known/oauth-protected-resource${basePath}`,
      handleProtectedResourceMetadata
    );
  }
}
