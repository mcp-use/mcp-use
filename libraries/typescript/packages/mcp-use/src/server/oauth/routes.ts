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
 *    - Redirects /authorize to upstream, brokering the callback through its
 *      own /oauth/callback so only `<baseUrl>/oauth/callback` needs to be
 *      registered with the upstream provider
 *    - Forwards /token requests with injected credentials
 *    - Synthesizes `.well-known` metadata pointing to local endpoints
 */

import type { Context, Hono, Next } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { OAuthProvider, OAuthProxy } from "./providers/types.js";
import {
  buildLocalOAuthAuthorizationServerPath,
  buildOAuthAuthorizationServerMetadataUrl,
  buildOpenIdConfigurationMetadataUrl,
  getIssuerPath,
} from "./well-known.js";

/**
 * Type guard to check if oauth config is a proxy
 */
export function isOAuthProxy(
  oauth: OAuthProvider | OAuthProxy
): oauth is OAuthProxy {
  return (oauth as OAuthProxy).type === "proxy";
}

/**
 * Callback transaction carried through the upstream `state` parameter.
 *
 * In proxy mode the client's redirect_uri and state are packed into the
 * `state` value sent upstream (base64url JSON), so /oauth/callback can
 * restore them without any server-side storage. This keeps the broker
 * stateless — it survives restarts and multi-instance deployments.
 */
interface CallbackTxn {
  /** Client's original redirect_uri */
  redirectUri: string;
  /** Client's original state, if any */
  state?: string;
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeCallbackTxn(txn: CallbackTxn): string {
  return base64UrlEncode(JSON.stringify(txn));
}

function decodeCallbackTxn(value: string): CallbackTxn | null {
  try {
    const parsed = JSON.parse(base64UrlDecode(value));
    if (
      typeof parsed?.redirectUri !== "string" ||
      !isValidRedirectUri(parsed.redirectUri)
    ) {
      return null;
    }
    return {
      redirectUri: parsed.redirectUri,
      state: typeof parsed.state === "string" ? parsed.state : undefined,
    };
  } catch {
    return null;
  }
}

function isValidRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Authorization endpoint handler
 *
 * In DCR-direct mode (OAuthProvider): Dormant — clients reach upstream directly.
 * In proxy mode (OAuthProxy): Active — redirects to upstream, replacing the
 * client's redirect_uri with the local /oauth/callback so only the proxy's
 * callback needs to be registered upstream. The client's redirect_uri and
 * state are packed into the upstream `state` and restored at the callback.
 * PKCE parameters pass through untouched, so the challenge/verifier pair
 * stays end-to-end between the MCP client and the upstream provider.
 *
 * @param oauth - The OAuth provider or proxy
 * @param baseUrl - The base URL of this server (for the brokered callback)
 * @returns Hono handler that redirects to the upstream authorize endpoint
 */
function createAuthorizeHandler(
  oauth: OAuthProvider | OAuthProxy,
  baseUrl: string
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

    if (!isValidRedirectUri(redirectUri as string)) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "redirect_uri must be a valid http(s) URL",
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
      // Broker the callback: send upstream to the local /oauth/callback and
      // carry the client's redirect_uri + state inside the upstream state.
      // Only `<baseUrl>/oauth/callback` needs to be registered upstream.
      authUrl.searchParams.set("redirect_uri", `${baseUrl}/oauth/callback`);
      authUrl.searchParams.set(
        "state",
        encodeCallbackTxn({
          redirectUri: redirectUri as string,
          state: state ? (state as string) : undefined,
        })
      );
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
 * Brokered callback endpoint handler (proxy mode only)
 *
 * Receives the upstream provider's redirect at `<baseUrl>/oauth/callback`,
 * restores the client's original redirect_uri + state from the upstream
 * `state` parameter, and forwards the authorization code (or upstream error)
 * to the client. The code itself passes through untouched — the client
 * exchanges it at the local /token endpoint, which rewrites redirect_uri to
 * match what was sent upstream.
 *
 * If the `state` parameter doesn't decode to a broker transaction, the
 * request falls through to later routes: browser clients (e.g. `useMcp`)
 * default their own redirect URI to `/oauth/callback` on their origin, and a
 * frontend served from the same origin as this server must keep receiving
 * its callback page.
 *
 * @returns Hono handler that redirects back to the MCP client's callback
 */
function createCallbackHandler(): (
  c: Context,
  next: Next
) => Promise<Response | void> {
  return async (c: Context, next: Next) => {
    const query = c.req.query();

    const txn = query.state ? decodeCallbackTxn(query.state) : null;
    if (!txn) {
      // No decodable broker transaction in `state`. This is expected when a
      // same-origin frontend serves its own callback page at /oauth/callback,
      // so pass through to let its route handle the request. If you expected
      // the proxy to handle this redirect, the upstream provider isn't
      // echoing back the `state` the proxy sent at /authorize.
      return next();
    }

    const redirect = new URL(txn.redirectUri);

    if (query.error) {
      // Forward upstream errors (e.g. access_denied) to the client
      redirect.searchParams.set("error", query.error);
      if (query.error_description) {
        redirect.searchParams.set("error_description", query.error_description);
      }
      if (query.error_uri) {
        redirect.searchParams.set("error_uri", query.error_uri);
      }
    } else if (query.code) {
      redirect.searchParams.set("code", query.code);
    } else {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Callback is missing both code and error",
        },
        400
      );
    }

    if (txn.state !== undefined) {
      redirect.searchParams.set("state", txn.state);
    }

    return c.redirect(redirect.toString(), 302);
  };
}

/**
 * Token endpoint handler
 *
 * In DCR-direct mode (OAuthProvider): Dormant — clients call upstream directly.
 * In proxy mode (OAuthProxy): Active — injects clientId/clientSecret and
 * rewrites redirect_uri to the brokered /oauth/callback before forwarding
 * (RFC 6749 §4.1.3 requires it to match the authorize request, which used
 * the local callback rather than the client's).
 *
 * @param oauth - The OAuth provider or proxy
 * @param baseUrl - The base URL of this server (for the brokered callback)
 * @returns Hono handler that forwards form-encoded token exchanges upstream
 */
function createTokenHandler(
  oauth: OAuthProvider | OAuthProxy,
  baseUrl: string
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

        // The authorize request used the brokered /oauth/callback, so the
        // token exchange must present the same redirect_uri — not the
        // client's own callback.
        if (requestBody.has("redirect_uri")) {
          requestBody.set("redirect_uri", `${baseUrl}/oauth/callback`);
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
 * - GET/POST /authorize - Redirects to upstream, brokering the callback locally
 * - GET /oauth/callback - Receives the upstream redirect and forwards the
 *   code to the MCP client's original redirect_uri
 * - POST /token - Forwards with injected credentials and the brokered redirect_uri
 * - GET /.well-known/* - Synthesized metadata pointing to local endpoints
 *
 * @param app - The Hono application instance
 * @param oauth - The OAuth provider or proxy
 * @param baseUrl - The base URL of this server (for metadata)
 */
export function setupOAuthRoutes(
  app: Hono,
  oauth: OAuthProvider | OAuthProxy,
  baseUrl: string
): void {
  const proxyMode = isOAuthProxy(oauth);
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
  const handleAuthorize = createAuthorizeHandler(oauth, baseUrl);
  app.get("/authorize", handleAuthorize);
  app.post("/authorize", handleAuthorize);
  app.post("/token", createTokenHandler(oauth, baseUrl));

  // In proxy mode, add /register endpoint that returns the configured clientId
  // This allows MCP clients to "register" even though the client is pre-registered
  if (proxyMode) {
    const proxy = oauth as OAuthProxy;

    // Brokered upstream callback. This is a top-level browser navigation
    // (no CORS needed) — register `<baseUrl>/oauth/callback` as the only
    // redirect URI on the upstream provider.
    app.get("/oauth/callback", createCallbackHandler());

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

  const synthesizeProxyMetadata = () => {
    const proxy = oauth as OAuthProxy;
    console.log(`[OAuth] Returning proxy mode metadata`);

    return {
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
    };
  };

  const fetchUpstreamMetadata = async (
    metadataUrl: string,
    c: Context
  ): Promise<Response> => {
    console.log(`[OAuth] Fetching metadata from provider: ${metadataUrl}`);
    const response = await fetch(metadataUrl);

    if (!response.ok) {
      console.error(
        `[OAuth] Failed to fetch provider metadata: ${response.status}`
      );
      return c.json(
        {
          error: "server_error",
          error_description: "Failed to fetch provider metadata",
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
  };

  /**
   * OAuth Authorization Server Metadata
   * As per RFC 8414: https://tools.ietf.org/html/rfc8414
   *
   * DCR-direct mode: Fetches and returns metadata from upstream provider.
   * Proxy mode: Synthesizes metadata pointing to local endpoints.
   */
  const handleOAuthAuthorizationServerMetadata = async (c: Context) => {
    const requestPath = new URL(c.req.url).pathname;
    console.log(`[OAuth] OAuth metadata request: ${requestPath}`);

    if (proxyMode) {
      return c.json(synthesizeProxyMetadata());
    }

    try {
      const issuer = oauth.getIssuer();
      const metadataUrl = buildOAuthAuthorizationServerMetadataUrl(issuer);
      return await fetchUpstreamMetadata(metadataUrl, c);
    } catch (error) {
      console.error(`[OAuth] Error fetching provider metadata:`, error);
      return c.json(
        {
          error: "server_error",
          error_description: "Failed to fetch provider metadata",
        },
        500
      );
    }
  };

  /**
   * OpenID Provider Configuration
   *
   * DCR-direct mode: Fetches OIDC metadata from upstream (appended to issuer).
   * Proxy mode: Synthesizes metadata pointing to local endpoints.
   */
  const handleOpenIdConfigurationMetadata = async (c: Context) => {
    const requestPath = new URL(c.req.url).pathname;
    console.log(`[OAuth] OpenID metadata request: ${requestPath}`);

    if (proxyMode) {
      return c.json(synthesizeProxyMetadata());
    }

    try {
      const issuer = oauth.getIssuer();
      const metadataUrl = buildOpenIdConfigurationMetadataUrl(issuer);
      return await fetchUpstreamMetadata(metadataUrl, c);
    } catch (error) {
      console.error(`[OAuth] Error fetching provider metadata:`, error);
      return c.json(
        {
          error: "server_error",
          error_description: "Failed to fetch provider metadata",
        },
        500
      );
    }
  };

  // OAuth Authorization Server Metadata: mount the root route plus the RFC 8414
  // canonical path-suffixed route. In proxy mode the local server is the AS
  // (no issuer path); in DCR-direct mode the upstream issuer path determines
  // the canonical mount suffix.
  const issuerPath = proxyMode ? "" : getIssuerPath(oauth.getIssuer());
  const oauthMetadataPaths = [
    buildLocalOAuthAuthorizationServerPath(""),
    ...(issuerPath ? [buildLocalOAuthAuthorizationServerPath(issuerPath)] : []),
  ];
  for (const path of oauthMetadataPaths) {
    app.get(path, handleOAuthAuthorizationServerMetadata);
  }

  // OpenID Provider Configuration: only the root route is mounted. OIDC
  // Discovery appends the well-known segment to the issuer rather than
  // inserting it after the host, so there is no path-suffixed form that lives
  // under the `/.well-known/openid-configuration` prefix — and no client flow
  // reaches a path-suffixed local route regardless (DCR-direct clients query
  // the upstream issuer directly; legacy clients query the local origin root).
  app.get(
    "/.well-known/openid-configuration",
    handleOpenIdConfigurationMetadata
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
