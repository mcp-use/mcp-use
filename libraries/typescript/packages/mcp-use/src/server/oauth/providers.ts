/**
 * OAuth Provider Factory Functions
 *
 * Export factory functions for creating OAuth providers with better
 * type safety and developer experience.
 */

import type { OAuthProvider } from "./providers/types.js";
import { SupabaseOAuthProvider } from "./providers/supabase.js";
import { Auth0OAuthProvider } from "./providers/auth0.js";
import { KeycloakOAuthProvider } from "./providers/keycloak.js";
import { WorkOSOAuthProvider } from "./providers/workos.js";
import { BetterAuthOAuthProvider } from "./providers/better-auth.js";
import { CustomOAuthProvider } from "./providers/custom.js";
import type { UserInfo } from "./providers/types.js";
import { getEnv } from "../utils/runtime.js";

/**
 * Configuration for Supabase OAuth provider
 */
export interface SupabaseProviderConfig {
  projectId: string;
  jwtSecret?: string;
  verifyJwt?: boolean;
  scopesSupported?: string[];
}

/**
 * Configuration for Auth0 OAuth provider
 */
export interface Auth0ProviderConfig {
  domain: string;
  audience: string;
  verifyJwt?: boolean;
  scopesSupported?: string[];
}

/**
 * Configuration for Keycloak OAuth provider
 */
export interface KeycloakProviderConfig {
  serverUrl: string;
  realm: string;
  /** MCP server URL used to validate the JWT `aud` claim (set via Keycloak audience mapper on client scopes) */
  audience?: string;
  verifyJwt?: boolean;
  scopesSupported?: string[];
}

/**
 * Configuration for WorkOS OAuth provider
 */
export interface WorkOSProviderConfig {
  subdomain: string;
  verifyJwt?: boolean;
  scopesSupported?: string[];
}

/**
 * Configuration for Custom OAuth provider
 */
export interface CustomProviderConfig {
  issuer: string;
  authEndpoint: string;
  tokenEndpoint: string;
  verifyToken: (token: string) => Promise<any>;
  jwksUrl?: string;
  userInfoEndpoint?: string;
  scopesSupported?: string[];
  audience?: string;
  grantTypesSupported?: string[];
  getUserInfo?: (payload: any) => UserInfo;
}

/**
 * Create a Supabase OAuth provider
 *
 * Supports zero-config setup via environment variables:
 * - MCP_USE_OAUTH_SUPABASE_PROJECT_ID (required)
 * - MCP_USE_OAUTH_SUPABASE_JWT_SECRET (optional)
 *
 * @param config - Optional Supabase configuration (overrides environment variables)
 * @returns OAuthProvider instance
 *
 * @example Zero-config with environment variables
 * ```typescript
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   oauth: oauthSupabaseProvider()
 * });
 * ```
 *
 * @example With explicit configuration
 * ```typescript
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   oauth: oauthSupabaseProvider({
 *     projectId: 'my-project',
 *     jwtSecret: process.env.SUPABASE_JWT_SECRET
 *   })
 * });
 * ```
 */
export function oauthSupabaseProvider(
  config: Partial<SupabaseProviderConfig> = {}
): OAuthProvider {
  const projectId =
    config.projectId ?? getEnv("MCP_USE_OAUTH_SUPABASE_PROJECT_ID");
  const jwtSecret =
    config.jwtSecret ?? getEnv("MCP_USE_OAUTH_SUPABASE_JWT_SECRET");

  if (!projectId) {
    throw new Error(
      "Supabase projectId is required. " +
        "Set MCP_USE_OAUTH_SUPABASE_PROJECT_ID environment variable or pass projectId in config."
    );
  }

  return new SupabaseOAuthProvider({
    provider: "supabase",
    projectId,
    jwtSecret,
    verifyJwt: config.verifyJwt,
    scopesSupported: config.scopesSupported,
  });
}

/**
 * Create an Auth0 OAuth provider
 *
 * Supports zero-config setup via environment variables:
 * - MCP_USE_OAUTH_AUTH0_DOMAIN (required)
 * - MCP_USE_OAUTH_AUTH0_AUDIENCE (required)
 *
 * @param config - Optional Auth0 configuration (overrides environment variables)
 * @returns OAuthProvider instance
 *
 * @example Zero-config with environment variables
 * ```typescript
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   oauth: oauthAuth0Provider()
 * });
 * ```
 *
 * @example With explicit configuration
 * ```typescript
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   oauth: oauthAuth0Provider({
 *     domain: 'my-tenant.auth0.com',
 *     audience: 'https://my-api.com'
 *   })
 * });
 * ```
 */
export function oauthAuth0Provider(
  config: Partial<Auth0ProviderConfig> = {}
): OAuthProvider {
  const domain = config.domain ?? getEnv("MCP_USE_OAUTH_AUTH0_DOMAIN");
  const audience = config.audience ?? getEnv("MCP_USE_OAUTH_AUTH0_AUDIENCE");

  if (!domain) {
    throw new Error(
      "Auth0 domain is required. " +
        "Set MCP_USE_OAUTH_AUTH0_DOMAIN environment variable or pass domain in config."
    );
  }

  if (!audience) {
    throw new Error(
      "Auth0 audience is required. " +
        "Set MCP_USE_OAUTH_AUTH0_AUDIENCE environment variable or pass audience in config."
    );
  }

  return new Auth0OAuthProvider({
    provider: "auth0",
    domain,
    audience,
    verifyJwt: config.verifyJwt,
    scopesSupported: config.scopesSupported,
  });
}

/**
 * Create a Keycloak OAuth provider
 *
 * Supports zero-config setup via environment variables:
 * - MCP_USE_OAUTH_KEYCLOAK_SERVER_URL (required)
 * - MCP_USE_OAUTH_KEYCLOAK_REALM (required)
 * - MCP_USE_OAUTH_KEYCLOAK_CLIENT_ID (optional)
 *
 * @param config - Optional Keycloak configuration (overrides environment variables)
 * @returns OAuthProvider instance
 *
 * @example Zero-config with environment variables
 * ```typescript
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   oauth: oauthKeycloakProvider()
 * });
 * ```
 *
 * @example With explicit configuration
 * ```typescript
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   oauth: oauthKeycloakProvider({
 *     serverUrl: 'https://keycloak.example.com',
 *     realm: 'my-realm',
 *     audience: 'https://my-mcp-server.example.com/mcp'
 *   })
 * });
 * ```
 */
export function oauthKeycloakProvider(
  config: Partial<KeycloakProviderConfig> = {}
): OAuthProvider {
  const serverUrl =
    config.serverUrl ?? getEnv("MCP_USE_OAUTH_KEYCLOAK_SERVER_URL");
  const realm = config.realm ?? getEnv("MCP_USE_OAUTH_KEYCLOAK_REALM");
  const audience = config.audience ?? getEnv("MCP_USE_OAUTH_KEYCLOAK_AUDIENCE");

  if (!serverUrl) {
    throw new Error(
      "Keycloak serverUrl is required. " +
        "Set MCP_USE_OAUTH_KEYCLOAK_SERVER_URL environment variable or pass serverUrl in config."
    );
  }

  if (!realm) {
    throw new Error(
      "Keycloak realm is required. " +
        "Set MCP_USE_OAUTH_KEYCLOAK_REALM environment variable or pass realm in config."
    );
  }

  return new KeycloakOAuthProvider({
    provider: "keycloak",
    serverUrl,
    realm,
    audience,
    verifyJwt: config.verifyJwt,
    scopesSupported: config.scopesSupported,
  });
}

/**
 * Create a WorkOS OAuth provider
 *
 * Uses Dynamic Client Registration (DCR). MCP clients register themselves
 * automatically with WorkOS — enable DCR in the WorkOS Dashboard under
 * Connect → Configuration. The MCP server only verifies WorkOS-issued
 * tokens; authorize/token/register are all discovered via `.well-known`
 * and called directly against WorkOS.
 *
 * Environment variables:
 * - MCP_USE_OAUTH_WORKOS_SUBDOMAIN (required)
 *
 * @param config - Optional WorkOS configuration (overrides environment variables)
 * @returns OAuthProvider instance
 *
 * @example
 * ```typescript
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   oauth: oauthWorkOSProvider({
 *     subdomain: 'my-company.authkit.app'
 *   })
 * });
 * ```
 */
export function oauthWorkOSProvider(
  config: Partial<WorkOSProviderConfig> = {}
): OAuthProvider {
  const subdomain =
    config.subdomain ?? getEnv("MCP_USE_OAUTH_WORKOS_SUBDOMAIN");

  if (!subdomain) {
    throw new Error(
      "WorkOS subdomain is required. " +
        "Set MCP_USE_OAUTH_WORKOS_SUBDOMAIN environment variable or pass subdomain in config."
    );
  }

  return new WorkOSOAuthProvider({
    provider: "workos",
    subdomain,
    verifyJwt: config.verifyJwt,
    scopesSupported: config.scopesSupported,
  });
}

/**
 * Configuration for Better Auth OAuth provider
 */
export interface BetterAuthProviderConfig {
  authURL: string;
  verifyJwt?: boolean;
  scopesSupported?: string[];
  getUserInfo?: (
    payload: Record<string, unknown>
  ) => UserInfo | Promise<UserInfo>;
}

/**
 * Create a Better Auth OAuth provider
 *
 * MCP clients discover Better Auth's OAuth endpoints via `.well-known`
 * passthrough and communicate directly with Better Auth for registration,
 * authorization, and token exchange. The MCP server only verifies tokens
 * and provides metadata.
 *
 * Better Auth's OAuth Provider plugin exposes standard OAuth 2.0 endpoints:
 * - /oauth2/authorize - Authorization endpoint
 * - /oauth2/token - Token endpoint
 * - /oauth2/register - Dynamic Client Registration
 * - /jwks - JSON Web Key Set for token verification
 *
 * Environment variables:
 * - MCP_USE_OAUTH_BETTER_AUTH_URL (required)
 *
 * @param config - Optional Better Auth configuration (overrides environment variables)
 * @returns OAuthProvider instance
 *
 * @example
 * ```typescript
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   oauth: oauthBetterAuthProvider({
 *     authURL: 'http://localhost:3000/api/auth'
 *   })
 * });
 * ```
 *
 */
export function oauthBetterAuthProvider(
  config: Partial<BetterAuthProviderConfig> = {}
): OAuthProvider {
  const authURL = config.authURL ?? getEnv("MCP_USE_OAUTH_BETTER_AUTH_URL");

  if (!authURL) {
    throw new Error(
      "Better Auth authURL is required. " +
        "Set MCP_USE_OAUTH_BETTER_AUTH_URL environment variable or pass authURL in config."
    );
  }

  return new BetterAuthOAuthProvider({
    provider: "better-auth",
    authURL,
    verifyJwt: config.verifyJwt,
    scopesSupported: config.scopesSupported,
    getUserInfo: config.getUserInfo,
  });
}

/**
 * Create a custom OAuth provider
 *
 * @param config - Custom provider configuration
 * @returns OAuthProvider instance
 *
 * @example
 * ```typescript
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   oauth: oauthCustomProvider({
 *     issuer: 'https://oauth.example.com',
 *     jwksUrl: 'https://oauth.example.com/.well-known/jwks.json',
 *     authEndpoint: 'https://oauth.example.com/authorize',
 *     tokenEndpoint: 'https://oauth.example.com/token',
 *     verifyToken: async (token) => {
 *       // Custom verification logic
 *       return jwtVerify(token, ...);
 *     }
 *   })
 * });
 * ```
 */
export function oauthCustomProvider(
  config: CustomProviderConfig
): OAuthProvider {
  return new CustomOAuthProvider({ provider: "custom", ...config });
}
