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
import {
  createInMemoryStateStore,
  DEFAULT_OAUTH_STATE_TTL_MS,
  type OAuthStateStore,
} from "./state-store.js";

/**
 * Path of the proxy's own OAuth redirect endpoint.
 *
 * The MCP server registers `${baseUrl}${PROXY_CALLBACK_PATH}` with the
 * upstream provider; the proxy then brokers the redirect back to the
 * original MCP client.
 */
export const PROXY_CALLBACK_PATH = "/oauth/callback";

function buildProxyCallbackUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${PROXY_CALLBACK_PATH}`;
}

function isAllowedClientRedirectUri(
  proxy: OAuthProxy,
  candidate: string
): boolean {
  if (!proxy.allowedClientRedirectUris) return true;
  return proxy.allowedClientRedirectUris.includes(candidate);
}

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
 * In proxy mode (OAuthProxy): Active. The proxy:
 *   1. Validates the client `redirect_uri` against `allowedClientRedirectUris`
 *      (when configured).
 *   2. Generates an opaque `proxyState` and records the original client
 *      `redirect_uri`/`state` in the state store.
 *   3. Forwards the request upstream with `redirect_uri` swapped to the
 *      proxy's own `/oauth/callback` and `state` swapped to `proxyState`.
 *
 * The original client `state` is restored at the callback step.
 *
 * @param oauth - The OAuth provider or proxy
 * @param baseUrl - The base URL of the MCP server (only used in proxy mode)
 * @param stateStore - In-flight state store (only used in proxy mode)
 * @returns Hono handler that redirects to the upstream authorize endpoint
 */
function createAuthorizeHandler(
  oauth: OAuthProvider | OAuthProxy,
  baseUrl?: string,
  stateStore?: OAuthStateStore
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
    authUrl.searchParams.set("response_type", responseType as string);
    authUrl.searchParams.set("code_challenge", codeChallenge as string);
    authUrl.searchParams.set(
      "code_challenge_method",
      (codeChallengeMethod as string) || "S256"
    );

    if (scope) authUrl.searchParams.set("scope", scope as string);
    if (audience) authUrl.searchParams.set("audience", audience as string);

    if (isOAuthProxy(oauth)) {
      if (!baseUrl || !stateStore) {
        // Defensive: setupOAuthRoutes always wires these in proxy mode.
        return c.json(
          {
            error: "server_error",
            error_description:
              "OAuth proxy is missing baseUrl or state store wiring",
          },
          500
        );
      }

      const clientRedirectUri = redirectUri as string;
      if (!isAllowedClientRedirectUri(oauth, clientRedirectUri)) {
        return c.json(
          {
            error: "invalid_request",
            error_description: "redirect_uri is not allowed",
          },
          400
        );
      }

      // Mint our own state, store the originals, and forward upstream with
      // our `/oauth/callback` as redirect_uri. The upstream provider only
      // ever sees the proxy's callback URL; the client URI never leaves
      // this process.
      const proxyState = crypto.randomUUID();
      await stateStore.set(
        proxyState,
        {
          clientRedirectUri,
          clientState: state ? (state as string) : undefined,
        },
        DEFAULT_OAUTH_STATE_TTL_MS
      );

      authUrl.searchParams.set("redirect_uri", buildProxyCallbackUrl(baseUrl));
      authUrl.searchParams.set("state", proxyState);
      // Override with the configured upstream client_id; the incoming value
      // may be stale DCR cache.
      authUrl.searchParams.set("client_id", oauth.clientId);
      if (oauth.extraAuthorizeParams) {
        for (const [key, value] of Object.entries(oauth.extraAuthorizeParams)) {
          authUrl.searchParams.set(key, value);
        }
      }
    } else {
      authUrl.searchParams.set("redirect_uri", redirectUri as string);
      if (state) authUrl.searchParams.set("state", state as string);
      authUrl.searchParams.set("client_id", clientId as string);
    }

    // Redirect to provider
    return c.redirect(authUrl.toString(), 302);
  };
}

/**
 * Callback endpoint handler (proxy mode only).
 *
 * Receives the upstream provider's redirect, looks up the original client
 * `redirect_uri` and `state` by the proxy state value, and 302s to the
 * client URL with the upstream-issued `code` and the *original* client
 * `state`. `error`/`error_description` are forwarded the same way.
 *
 * Records are consumed on read, so a given proxy state can only be used
 * once.
 *
 * @param stateStore - In-flight state store
 * @returns Hono handler for `GET /oauth/callback`
 */
export function createCallbackHandler(
  stateStore: OAuthStateStore
): (c: Context) => Promise<Response> {
  return async (c: Context) => {
    const proxyState = c.req.query("state");
    if (!proxyState) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Missing state parameter",
        },
        400
      );
    }

    const record = await stateStore.get(proxyState);
    if (!record) {
      return c.json(
        {
          error: "invalid_request",
          error_description:
            "Unknown or expired state — restart the OAuth flow",
        },
        400
      );
    }

    const redirect = new URL(record.clientRedirectUri);
    const passthrough = ["code", "error", "error_description"] as const;
    for (const name of passthrough) {
      const value = c.req.query(name);
      if (value !== undefined) {
        redirect.searchParams.set(name, value);
      }
    }
    if (record.clientState !== undefined) {
      redirect.searchParams.set("state", record.clientState);
    }

    return c.redirect(redirect.toString(), 302);
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
  oauth: OAuthProvider | OAuthProxy,
  baseUrl?: string
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

        // The upstream provider verifies that the token-exchange
        // `redirect_uri` matches the one used at /authorize. Since we
        // forwarded the proxy callback to /authorize, we override the
        // client-supplied value here too. Refresh-token requests don't
        // carry redirect_uri so we only touch authorization_code flows.
        const grantType = requestBody.get("grant_type");
        if (
          baseUrl &&
          (!grantType || grantType === "authorization_code") &&
          requestBody.has("redirect_uri")
        ) {
          requestBody.set("redirect_uri", buildProxyCallbackUrl(baseUrl));
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
 * - GET/POST /authorize - Stores the client's redirect_uri, forwards upstream
 *   with the proxy's `/oauth/callback` as redirect_uri and a minted state
 * - GET /oauth/callback - Receives upstream redirect, restores the original
 *   client redirect_uri/state, and 302s the client with the auth code
 * - POST /token - Forwards with injected credentials and overrides
 *   redirect_uri to the proxy callback (so the upstream match passes)
 * - GET /.well-known/* - Synthesized metadata pointing to local endpoints
 *
 * @param app - The Hono application instance
 * @param oauth - The OAuth provider or proxy
 * @param baseUrl - The base URL of this server (for metadata)
 * @param options.stateStore - Optional custom in-flight state store. Defaults
 *   to an in-memory implementation; supply a shared store for multi-replica
 *   deployments.
 */
export function setupOAuthRoutes(
  app: Hono,
  oauth: OAuthProvider | OAuthProxy,
  baseUrl: string,
  options: { stateStore?: OAuthStateStore } = {}
): void {
  const proxyMode = isOAuthProxy(oauth);
  const stateStore = proxyMode
    ? (options.stateStore ?? createInMemoryStateStore())
    : undefined;
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
  const handleAuthorize = createAuthorizeHandler(oauth, baseUrl, stateStore);
  app.get("/authorize", handleAuthorize);
  app.post("/authorize", handleAuthorize);
  app.post("/token", createTokenHandler(oauth, baseUrl));

  // In proxy mode, mount the redirect endpoint that upstream providers call
  // back into. The handler restores the client's original redirect URI and
  // 302s with the upstream-issued code + the original client state.
  if (proxyMode && stateStore) {
    app.use(
      PROXY_CALLBACK_PATH,
      cors({
        origin: "*",
        allowMethods: ["GET", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
        maxAge: 86400,
      })
    );
    app.get(PROXY_CALLBACK_PATH, createCallbackHandler(stateStore));
  }

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

      return c.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        registration_endpoint: `${baseUrl}/register`,
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
   * DCR-direct mode: Points to the actual OAuth provider.
   * Proxy mode: Points to the local server (which proxies to upstream).
   */
  app.get("/.well-known/oauth-protected-resource", (c: Context) => {
    // In proxy mode, the authorization server is the local proxy
    const authServer = proxyMode ? baseUrl : oauth.getIssuer();

    console.log(`[OAuth] Protected resource metadata request`);
    console.log(`[OAuth]   - Resource: ${baseUrl}`);
    console.log(`[OAuth]   - Authorization server: ${authServer}`);

    return c.json({
      resource: baseUrl,
      authorization_servers: [authServer],
      scopes_supported: oauth.getScopesSupported(),
      bearer_methods_supported: ["header"],
    });
  });

  // Path-scoped protected resource metadata per RFC 9728 — declares that the
  // `/mcp` path specifically is the protected resource.
  app.get("/.well-known/oauth-protected-resource/mcp", (c: Context) => {
    const authServer = proxyMode ? baseUrl : oauth.getIssuer();

    return c.json({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [authServer],
      scopes_supported: oauth.getScopesSupported(),
      bearer_methods_supported: ["header"],
    });
  });

  // Path-scoped protected resource metadata for the `/sse` transport, which is
  // mounted alongside `/mcp` and is equally protected by the bearer middleware.
  app.get("/.well-known/oauth-protected-resource/sse", (c: Context) => {
    const authServer = proxyMode ? baseUrl : oauth.getIssuer();

    return c.json({
      resource: `${baseUrl}/sse`,
      authorization_servers: [authServer],
      scopes_supported: oauth.getScopesSupported(),
      bearer_methods_supported: ["header"],
    });
  });
}
