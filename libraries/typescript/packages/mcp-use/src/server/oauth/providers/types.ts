/**
 * OAuth mode determines how the MCP server handles OAuth requests
 */
export type OAuthMode =
  | "direct" // Clients communicate directly with auth server (e.g., WorkOS)
  | "proxy"; // MCP server proxies OAuth requests (legacy mode)

/**
 * OAuth Provider Interface
 *
 * Defines the contract that all OAuth providers must implement
 * to provide authentication and authorization services.
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
   * Get the OAuth mode for this provider
   * @returns 'direct' if clients should communicate directly with auth server,
   *          'proxy' if MCP server should proxy OAuth requests
   */
  getMode?(): OAuthMode;

  /**
   * Get the registration endpoint URL (for direct mode with dynamic client registration)
   * @returns The registration endpoint URL, or undefined if not supported
   */
  getRegistrationEndpoint?(): string | undefined;

  /**
   * Get the configured OAuth client ID
   * @returns The client ID, or undefined if not configured
   */
  getClientId?(): string | undefined;

  /**
   * Get the user info endpoint URL
   * @returns The user info endpoint URL, or undefined if not configured
   */
  getUserInfoEndpoint?(): string | undefined;

  /**
   * Get the configured OAuth client secret
   * @returns The client secret, or undefined if not configured
   */
  getClientSecret?(): string | undefined;

  /**
   * Get extra parameters to include in the authorize redirect URL.
   * Used by proxy mode to inject provider-specific params (e.g., Auth0 audience)
   * that the MCP client wouldn't know to send.
   * @returns Record of extra query parameters, or undefined
   */
  getExtraAuthorizeParams?(): Record<string, string> | undefined;
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
  clientId?: string;
  clientSecret?: string;
  mode?: OAuthMode;
}

/**
 * Supabase OAuth provider configuration
 */
export interface SupabaseOAuthConfig extends BaseOAuthConfig {
  provider: "supabase";
  projectId: string;
  jwtSecret?: string;
  skipVerification?: boolean;
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
  verifyJwt?: boolean;
}

/**
 * WorkOS OAuth provider configuration
 */
export interface WorkOSOAuthConfig extends BaseOAuthConfig {
  provider: "workos";
  subdomain: string;
  apiKey?: string;
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
  /** OAuth client ID */
  clientId?: string;
  /** OAuth client secret */
  clientSecret?: string;
  /** OAuth mode: 'proxy' or 'direct' */
  mode?: OAuthMode;
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
