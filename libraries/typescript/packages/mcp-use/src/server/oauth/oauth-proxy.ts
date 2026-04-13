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

import { jwtVerify, createRemoteJWKSet } from "jose";
import type { OAuthProxy, UserInfo } from "./providers/types.js";

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
   * Token issuer for JWT verification
   * @example "https://accounts.google.com"
   */
  issuer: string;

  /**
   * JWKS URL for token verification
   * @example "https://www.googleapis.com/oauth2/v3/certs"
   */
  jwksUrl: string;

  /**
   * Pre-registered OAuth client ID
   */
  clientId: string;

  /**
   * Pre-registered OAuth client secret (optional for public clients)
   */
  clientSecret?: string;

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
   * Custom function to extract user info from JWT payload
   * If not provided, extracts standard OIDC claims (sub, email, name)
   */
  getUserInfo?: (payload: Record<string, unknown>) => UserInfo;
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
 * - Exposes a /register endpoint that returns the configured clientId
 * - Injects clientId/clientSecret at token exchange
 * - Verifies tokens against the upstream provider's JWKS
 * - Passes through upstream JWT tokens (no token minting)
 *
 * @param config - OAuth proxy configuration
 * @returns OAuthProxy instance
 *
 * @example Google OAuth
 * ```typescript
 * import { MCPServer, oauthProxy } from "mcp-use/server";
 *
 * const server = new MCPServer({
 *   name: "my-server",
 *   version: "1.0.0",
 *   oauth: oauthProxy({
 *     authEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
 *     tokenEndpoint: "https://oauth2.googleapis.com/token",
 *     issuer: "https://accounts.google.com",
 *     jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
 *     clientId: process.env.GOOGLE_CLIENT_ID!,
 *     clientSecret: process.env.GOOGLE_CLIENT_SECRET,
 *     scopes: ["openid", "email", "profile"],
 *     extraAuthorizeParams: {
 *       access_type: "offline",
 *       prompt: "consent",
 *     },
 *   }),
 * });
 * ```
 *
 * @example GitHub OAuth
 * ```typescript
 * import { MCPServer, oauthProxy } from "mcp-use/server";
 *
 * const server = new MCPServer({
 *   name: "my-server",
 *   version: "1.0.0",
 *   oauth: oauthProxy({
 *     authEndpoint: "https://github.com/login/oauth/authorize",
 *     tokenEndpoint: "https://github.com/login/oauth/access_token",
 *     // GitHub doesn't use JWKS - use a custom verifyToken
 *     // For now, this example shows the pattern for OIDC providers
 *     issuer: "https://github.com",
 *     jwksUrl: "https://token.actions.githubusercontent.com/.well-known/jwks",
 *     clientId: process.env.GITHUB_CLIENT_ID!,
 *     clientSecret: process.env.GITHUB_CLIENT_SECRET,
 *     scopes: ["read:user", "user:email"],
 *   }),
 * });
 * ```
 */
export function oauthProxy(config: OAuthProxyConfig): OAuthProxy {
  // Validate required fields
  if (!config.authEndpoint) {
    throw new Error("oauthProxy: authEndpoint is required");
  }
  if (!config.tokenEndpoint) {
    throw new Error("oauthProxy: tokenEndpoint is required");
  }
  if (!config.issuer) {
    throw new Error("oauthProxy: issuer is required");
  }
  if (!config.jwksUrl) {
    throw new Error("oauthProxy: jwksUrl is required");
  }
  if (!config.clientId) {
    throw new Error("oauthProxy: clientId is required");
  }

  // Create JWKS key set (lazily initialized)
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  const getJWKS = (): ReturnType<typeof createRemoteJWKSet> => {
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(config.jwksUrl));
    }
    return jwks;
  };

  const scopes = config.scopes ?? ["openid", "email", "profile"];
  const grantTypes = config.grantTypes ?? ["authorization_code", "refresh_token"];
  const customGetUserInfo = config.getUserInfo ?? defaultGetUserInfo;

  return {
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

    async verifyToken(token: string): Promise<{ payload: Record<string, unknown> }> {
      try {
        const result = await jwtVerify(token, getJWKS(), {
          issuer: config.issuer,
        });
        return { payload: result.payload as Record<string, unknown> };
      } catch (error) {
        throw new Error(`OAuth proxy JWT verification failed: ${error}`);
      }
    },

    getUserInfo(payload: Record<string, unknown>): UserInfo {
      return customGetUserInfo(payload);
    },
  };
}
