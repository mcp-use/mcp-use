/**
 * OAuth Provider Interface
 *
 * Defines the contract that all OAuth providers must implement
 * to provide authentication and authorization services.
 *
 * Built-in providers support the DCR-direct flow only: the MCP server
 * proxies metadata discovery (`.well-known/*`) to the upstream authorization
 * server and verifies bearer tokens. Clients communicate directly with the
 * upstream for authorize/token/register. A separate `oauthProxy`
 * will reintroduce proxy-mode behavior in a future change.
 */

export interface OAuthProvider {
  /**
   * Verify and decode a JWT token
   * @param token - The JWT token to verify
   * @returns The decoded and verified token payload
   * @throws Error if token is invalid or verification fails
   */
  verifyToken(token: string): Promise<{ payload: Record<string, unknown> }>;

  /**
   * Extract user information from a verified token payload
   * @param payload - The verified JWT payload
   * @returns User information object
   */
  getUserInfo(payload: Record<string, unknown>): UserInfo | Promise<UserInfo>;

  /**
   * Get the OAuth issuer URL
   * @returns The issuer URL for this provider
   */
  getIssuer(): string;

  /**
   * Get the authorization endpoint URL
   * @returns The authorization endpoint URL
   */
  getAuthEndpoint(): string;

  /**
   * Get the token endpoint URL
   * @returns The token endpoint URL
   */
  getTokenEndpoint(): string;

  /**
   * Get supported scopes
   * @returns Array of supported OAuth scopes
   */
  getScopesSupported(): string[];

  /**
   * Get supported grant types
   * @returns Array of supported grant types
   */
  getGrantTypesSupported(): string[];

  /**
   * Get the user info endpoint URL
   * @returns The user info endpoint URL, or undefined if not configured
   */
  getUserInfoEndpoint?(): string | undefined;

  /**
   * Get the audience for JWT verification
   * @returns The audience string, or undefined if not configured
   */
  getAudience?(): string | undefined;
}

/**
 * OAuth Proxy Interface
 *
 * Extends OAuthProvider with proxy-specific fields for providers that don't
 * support Dynamic Client Registration (e.g., Google OAuth, GitHub OAuth).
 *
 * OAuthProxy:
 * - Implements the full OAuthProvider interface (getter methods)
 * - Adds proxy-specific fields: type, clientId, clientSecret, extraAuthorizeParams
 * - Exposes /register endpoint returning the configured clientId
 * - Injects clientId/clientSecret at token exchange
 * - Passes through upstream JWT tokens (no token minting)
 */
export interface OAuthProxy extends OAuthProvider {
  /**
   * Discriminator for union type detection
   */
  type: "proxy";

  /**
   * Pre-registered OAuth client ID
   */
  clientId: string;

  /**
   * Pre-registered OAuth client secret (optional for public clients)
   */
  clientSecret?: string;

  /**
   * Extra parameters to include in authorize requests
   */
  extraAuthorizeParams?: Record<string, string>;
}

/**
 * User information extracted from OAuth token
 */
export interface UserInfo {
  userId: string;
  email?: string;
  name?: string;
  username?: string;
  nickname?: string;
  picture?: string;
  roles?: string[];
  permissions?: string[];
  [key: string]: unknown; // Allow additional custom claims
}

/**
 * Base configuration for all OAuth providers
 */
export interface BaseOAuthConfig {
  provider: string;
  scopesSupported?: string[];
}

/**
 * Supabase OAuth provider configuration
 */
export interface SupabaseOAuthConfig extends BaseOAuthConfig {
  provider: "supabase";
  projectId: string;
  jwtSecret?: string;
  verifyJwt?: boolean;
}

/**
 * Auth0 OAuth provider configuration
 */
export interface Auth0OAuthConfig extends BaseOAuthConfig {
  provider: "auth0";
  domain: string;
  audience: string;
  verifyJwt?: boolean;
}

/**
 * Keycloak OAuth provider configuration
 */
export interface KeycloakOAuthConfig extends BaseOAuthConfig {
  provider: "keycloak";
  serverUrl: string;
  realm: string;
  /** MCP server URL used to validate the JWT `aud` claim (set via Keycloak audience mapper on client scopes) */
  audience?: string;
  verifyJwt?: boolean;
}

/**
 * WorkOS OAuth provider configuration
 */
export interface WorkOSOAuthConfig extends BaseOAuthConfig {
  provider: "workos";
  subdomain: string;
  verifyJwt?: boolean;
}

/**
 * Better Auth OAuth provider configuration
 */
export interface BetterAuthOAuthConfig extends BaseOAuthConfig {
  provider: "better-auth";
  authURL: string;
  verifyJwt?: boolean;
  getUserInfo?: (
    payload: Record<string, unknown>
  ) => UserInfo | Promise<UserInfo>;
}

/**
 * Custom OAuth provider configuration
 */
export interface CustomOAuthConfig extends BaseOAuthConfig {
  provider: "custom";
  issuer: string;
  jwksUrl?: string;
  authEndpoint: string;
  tokenEndpoint: string;
  grantTypesSupported?: string[];
  verifyToken: (token: string) => Promise<{ payload: Record<string, unknown> }>;
  getUserInfo?: (payload: Record<string, unknown>) => UserInfo;
  /** User info endpoint URL */
  userInfoEndpoint?: string;
  /** Audience for JWT verification */
  audience?: string;
}

/**
 * Union type of all OAuth provider configurations
 */
export type OAuthConfig =
  | SupabaseOAuthConfig
  | Auth0OAuthConfig
  | KeycloakOAuthConfig
  | WorkOSOAuthConfig
  | BetterAuthOAuthConfig
  | CustomOAuthConfig;
