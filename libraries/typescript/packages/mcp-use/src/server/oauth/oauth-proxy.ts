/**
 * OAuth Proxy Factory
 *
 * Creates an OAuthProxy instance for providers that don't support
 * Dynamic Client Registration (DCR). The proxy accepts pre-registered
 * client credentials and injects them during token exchange.
 *
 * Use this for providers like Google OAuth, GitHub OAuth, or enterprise
 * IdPs that require pre-registered applications.
 */

import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import type { OAuthProxy, UserInfo } from "./providers/types.js";

const CLIENT_REGISTRATION_ISSUER = "urn:mcp-use:oauth-proxy";
const CLIENT_REGISTRATION_KEY_CONTEXT =
  "mcp-use/oauth-proxy/client-registration/v1";

interface OAuthProxyClientRegistration {
  redirectUris: string[];
}

const clientRegistrationKeys = new WeakMap<OAuthProxy, Promise<Uint8Array>>();

async function deriveClientRegistrationKey(
  secret: string | Uint8Array,
  upstreamClientId: string
): Promise<Uint8Array> {
  const secretBytes =
    typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  const contextBytes = new TextEncoder().encode(
    `${CLIENT_REGISTRATION_KEY_CONTEXT}\0${upstreamClientId}\0`
  );
  const keyMaterial = new Uint8Array(contextBytes.length + secretBytes.length);
  keyMaterial.set(contextBytes);
  keyMaterial.set(secretBytes, contextBytes.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", keyMaterial));
}

function getClientRegistrationKey(oauth: OAuthProxy): Promise<Uint8Array> {
  const existing = clientRegistrationKeys.get(oauth);
  if (existing) return existing;

  const ephemeralSecret = crypto.getRandomValues(new Uint8Array(32));
  const key = deriveClientRegistrationKey(
    oauth.clientSecret ?? ephemeralSecret,
    oauth.clientId
  );
  clientRegistrationKeys.set(oauth, key);
  return key;
}

/**
 * Issue a signed local client ID whose claims contain the redirect
 * URIs accepted during Dynamic Client Registration.
 *
 * This keeps proxy registration stateless and prevents the configured
 * upstream client ID from being exposed as the local public client ID.
 * @internal
 */
export async function createOAuthProxyClientRegistration(
  oauth: OAuthProxy,
  baseUrl: string,
  redirectUris: string[]
): Promise<string> {
  return new SignJWT({ redirect_uris: redirectUris })
    .setProtectedHeader({
      alg: "HS256",
      typ: "oauth-client-registration+jwt",
    })
    .setIssuer(CLIENT_REGISTRATION_ISSUER)
    .setAudience(baseUrl)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .sign(await getClientRegistrationKey(oauth));
}

/**
 * Verify and decode a local proxy client ID.
 * @internal
 */
export async function verifyOAuthProxyClientRegistration(
  oauth: OAuthProxy,
  baseUrl: string,
  clientId: string
): Promise<OAuthProxyClientRegistration | null> {
  try {
    const { payload } = await jwtVerify(
      clientId,
      await getClientRegistrationKey(oauth),
      {
        algorithms: ["HS256"],
        issuer: CLIENT_REGISTRATION_ISSUER,
        audience: baseUrl,
      }
    );
    const redirectUris = payload.redirect_uris;
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      redirectUris.some((value) => typeof value !== "string")
    ) {
      return null;
    }
    return { redirectUris };
  } catch {
    return null;
  }
}

/**
 * Token verification function.
 * Takes a bearer token and returns the decoded payload, or throws if invalid.
 */
export type VerifyToken = (
  token: string
) => Promise<{ payload: Record<string, unknown> }>;

/**
 * Configuration for creating an OAuth proxy
 */
export interface OAuthProxyConfig {
  /**
   * Upstream authorization endpoint URL
   * @example "https://accounts.google.com/o/oauth2/v2/auth"
   */
  authEndpoint: string;

  /**
   * Upstream token endpoint URL
   * @example "https://oauth2.googleapis.com/token"
   */
  tokenEndpoint: string;

  /**
   * Token issuer (used in metadata and — if you pair it with `jwksVerifier` —
   * enforced as the `iss` claim during JWT verification).
   * @example "https://accounts.google.com"
   */
  issuer: string;

  /**
   * Token verification function. Use the exported `jwksVerifier()` helper for
   * standard JWT+JWKS providers (Auth0, Okta, Google, etc.), or write your own
   * for non-JWT providers (e.g., GitHub opaque tokens validated via API call).
   */
  verifyToken: VerifyToken;

  /**
   * Pre-registered OAuth client ID
   */
  clientId: string;

  /**
   * Pre-registered OAuth client secret (optional for public clients)
   */
  clientSecret?: string;

  /**
   * Secret used to sign stateless local Dynamic Client Registration records.
   *
   * Defaults to a key derived from `clientSecret`. Set this explicitly when
   * the upstream client has no secret and registrations must survive restarts
   * or validate across multiple server instances.
   */
  registrationSecret?: string;

  /**
   * OAuth scopes to request
   * @default ["openid", "email", "profile"]
   */
  scopes?: string[];

  /**
   * Supported grant types
   * @default ["authorization_code", "refresh_token"]
   */
  grantTypes?: string[];

  /**
   * Extra parameters to include in authorize requests
   * Useful for provider-specific parameters like `access_type` or `prompt`
   * @example { access_type: "offline", prompt: "consent" }
   */
  extraAuthorizeParams?: Record<string, string>;

  /**
   * Custom function to extract user info from the verified token payload.
   * If not provided, extracts standard OIDC claims (sub, email, name, picture).
   */
  getUserInfo?: (payload: Record<string, unknown>) => UserInfo;
}

/**
 * Configuration for the built-in JWKS verifier
 */
export interface JwksVerifierConfig {
  /**
   * JWKS endpoint URL (the provider's public key set)
   * @example "https://your-domain.okta.com/oauth2/default/v1/keys"
   */
  jwksUrl: string;

  /**
   * Expected `iss` claim — tokens whose issuer doesn't match are rejected.
   * @example "https://your-domain.okta.com/oauth2/default"
   */
  issuer: string;

  /**
   * Expected `aud` claim (optional). When set, tokens without a matching
   * audience are rejected.
   */
  audience?: string;
}

/**
 * Build a `verifyToken` function that validates JWTs against a remote JWKS.
 *
 * The returned function performs signature verification, issuer checking,
 * and (if configured) audience checking via `jose`. Pass the result to
 * `oauthProxy({ verifyToken: jwksVerifier(...) })`.
 *
 * @example
 * ```ts
 * verifyToken: jwksVerifier({
 *   jwksUrl: "https://your-domain.okta.com/oauth2/default/v1/keys",
 *   issuer: "https://your-domain.okta.com/oauth2/default",
 * })
 * ```
 */
export function jwksVerifier(config: JwksVerifierConfig): VerifyToken {
  if (!config.jwksUrl) {
    throw new Error("jwksVerifier: jwksUrl is required");
  }
  if (!config.issuer) {
    throw new Error("jwksVerifier: issuer is required");
  }

  // `createRemoteJWKSet` doesn't fetch until the first verify call, so this
  // is cheap to do eagerly.
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl));

  return async (token) => {
    // A signed JWT has exactly three dot-separated segments. Opaque tokens —
    // what Auth0 and others issue when the authorize request carries no valid
    // `audience` — have none, and would otherwise fail deep inside jose as the
    // cryptic "JWSInvalid: Invalid Compact JWS". Catch it early with a hint
    // that points at the actual cause.
    if (token.split(".").length !== 3) {
      throw new Error(
        "Access token is not a signed JWT, so it can't be verified against the JWKS. " +
          "Many providers — Auth0 included — only issue JWT access tokens when the " +
          "authorization request specifies a valid `audience` (your API identifier). " +
          "Check your `audience` configuration."
      );
    }

    try {
      const result = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        ...(config.audience ? { audience: config.audience } : {}),
      });
      return { payload: result.payload as Record<string, unknown> };
    } catch (error) {
      throw new Error(`JWKS verification failed: ${error}`);
    }
  };
}

/**
 * Default user info extractor for standard OIDC tokens
 */
function defaultGetUserInfo(payload: Record<string, unknown>): UserInfo {
  const scope = payload.scope as string | undefined;
  return {
    userId: payload.sub as string,
    email: payload.email as string | undefined,
    name: payload.name as string | undefined,
    picture: payload.picture as string | undefined,
    // Extract scopes from the scope claim
    scopes: scope ? scope.split(" ") : [],
  };
}

/**
 * Create an OAuth proxy for providers without DCR support
 *
 * The proxy:
 * - Exposes a /register endpoint that issues a signed local public client ID
 * - Binds each local client ID to its registered redirect URIs
 * - Injects clientId/clientSecret at token exchange
 * - Verifies tokens via the supplied `verifyToken` function
 * - Passes through upstream tokens (no token minting)
 *
 * @param config - OAuth proxy configuration
 * @returns OAuthProxy instance
 *
 * @example Okta (JWT access tokens with JWKS)
 * ```typescript
 * import { MCPServer, oauthProxy, jwksVerifier } from "mcp-use/server";
 *
 * const server = new MCPServer({
 *   name: "my-server",
 *   version: "1.0.0",
 *   oauth: oauthProxy({
 *     authEndpoint: "https://your-domain.okta.com/oauth2/default/v1/authorize",
 *     tokenEndpoint: "https://your-domain.okta.com/oauth2/default/v1/token",
 *     issuer: "https://your-domain.okta.com/oauth2/default",
 *     clientId: process.env.OKTA_CLIENT_ID!,
 *     clientSecret: process.env.OKTA_CLIENT_SECRET,
 *     scopes: ["openid", "email", "profile"],
 *     verifyToken: jwksVerifier({
 *       jwksUrl: "https://your-domain.okta.com/oauth2/default/v1/keys",
 *       issuer: "https://your-domain.okta.com/oauth2/default",
 *     }),
 *   }),
 * });
 * ```
 */
export function oauthProxy(config: OAuthProxyConfig): OAuthProxy {
  if (!config.authEndpoint) {
    throw new Error("oauthProxy: authEndpoint is required");
  }
  if (!config.tokenEndpoint) {
    throw new Error("oauthProxy: tokenEndpoint is required");
  }
  if (!config.issuer) {
    throw new Error("oauthProxy: issuer is required");
  }
  if (!config.clientId) {
    throw new Error("oauthProxy: clientId is required");
  }
  if (!config.verifyToken) {
    throw new Error(
      "oauthProxy: verifyToken is required (use `jwksVerifier()` for JWT/JWKS providers)"
    );
  }
  if (config.registrationSecret !== undefined && !config.registrationSecret) {
    throw new Error("oauthProxy: registrationSecret must not be empty");
  }

  const scopes = config.scopes ?? ["openid", "email", "profile"];
  const grantTypes = config.grantTypes ?? [
    "authorization_code",
    "refresh_token",
  ];
  const customGetUserInfo = config.getUserInfo ?? defaultGetUserInfo;

  const proxy: OAuthProxy = {
    // Proxy-specific fields
    type: "proxy",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    extraAuthorizeParams: config.extraAuthorizeParams,

    // OAuthProvider interface implementation
    getIssuer: () => config.issuer,
    getAuthEndpoint: () => config.authEndpoint,
    getTokenEndpoint: () => config.tokenEndpoint,
    getScopesSupported: () => scopes,
    getGrantTypesSupported: () => grantTypes,

    verifyToken: config.verifyToken,

    getUserInfo(payload: Record<string, unknown>): UserInfo {
      return customGetUserInfo(payload);
    },
  };

  const registrationSecret =
    config.registrationSecret ??
    config.clientSecret ??
    crypto.getRandomValues(new Uint8Array(32));
  clientRegistrationKeys.set(
    proxy,
    deriveClientRegistrationKey(registrationSecret, config.clientId)
  );

  return proxy;
}
