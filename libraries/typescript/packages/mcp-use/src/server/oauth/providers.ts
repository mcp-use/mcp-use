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
import { CustomOAuthProvider } from "./providers/custom.js";
import type { UserInfo } from "./providers/types.js";
import { getEnv } from "../utils/runtime.js";

/**
 * Configuration for Supabase OAuth provider
 */
export interface SupabaseProviderConfig {
  projectId: string;
  jwtSecret?: string;
  skipVerification?: boolean;
}

/**
 * Configuration for Auth0 OAuth provider
 */
export interface Auth0ProviderConfig {
  domain: string;
  audience: string;
  verifyJwt?: boolean;
}

/**
 * Configuration for Keycloak OAuth provider
 */
export interface KeycloakProviderConfig {
  serverUrl: string;
  realm: string;
  clientId?: string;
  verifyJwt?: boolean;
}

/**
 * Configuration for WorkOS OAuth provider
 */
export interface WorkOSProviderConfig {
  subdomain: string;
  clientId?: string;
  apiKey?: string;
  verifyJwt?: boolean;
}

/**
 * Configuration for Custom OAuth provider
 */
export interface CustomProviderConfig {
  issuer: string;
  jwksUrl: string;
  authEndpoint: string;
  tokenEndpoint: string;
  scopesSupported?: string[];
  grantTypesSupported?: string[];
  verifyToken: (token: string) => Promise<any>;
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
    skipVerification: config.skipVerification,
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
 *     clientId: 'my-client'
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
  const clientId =
    config.clientId ?? getEnv("MCP_USE_OAUTH_KEYCLOAK_CLIENT_ID");

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
    clientId,
    verifyJwt: config.verifyJwt,
  });
}

/**
 * Create a WorkOS OAuth provider
 *
 * Supports two OAuth modes:
 *
 * **1. Dynamic Client Registration (DCR)** - Recommended for MCP
 * - Don't set MCP_USE_OAUTH_WORKOS_CLIENT_ID
 * - MCP clients register themselves automatically with WorkOS
 * - Enable DCR in WorkOS Dashboard under Connect → Configuration
 *
 * **2. Pre-registered OAuth Client** - For custom setups
 * - Set MCP_USE_OAUTH_WORKOS_CLIENT_ID to your OAuth client ID from WorkOS Dashboard
 * - Create the client in WorkOS Dashboard under Connect → OAuth Applications
 * - Configure redirect URIs in the dashboard to match your MCP client
 *
 * Environment variables:
 * - MCP_USE_OAUTH_WORKOS_SUBDOMAIN (required)
 * - MCP_USE_OAUTH_WORKOS_CLIENT_ID (optional, for pre-registered client)
 * - MCP_USE_OAUTH_WORKOS_API_KEY (optional, for WorkOS API calls)
 *
 * @param config - Optional WorkOS configuration (overrides environment variables)
 * @returns OAuthProvider instance
 *
 * @example Dynamic Client Registration (recommended)
 * ```typescript
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   oauth: oauthWorkOSProvider({
 *     subdomain: 'my-company'
 *   })
 * });
 * ```
 *
 * @example Pre-registered OAuth Client
 * ```typescript
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   oauth: oauthWorkOSProvider({
 *     subdomain: 'my-company',
 *     clientId: 'client_01KB5DRXBDDY1VGCBKY108SKJW'
 *   })
 * });
 * ```
 */
export function oauthWorkOSProvider(
  config: Partial<WorkOSProviderConfig> = {}
): OAuthProvider {
  const subdomain =
    config.subdomain ?? getEnv("MCP_USE_OAUTH_WORKOS_SUBDOMAIN");
  const clientId = config.clientId ?? getEnv("MCP_USE_OAUTH_WORKOS_CLIENT_ID");
  const apiKey = config.apiKey ?? getEnv("MCP_USE_OAUTH_WORKOS_API_KEY");

  if (!subdomain) {
    throw new Error(
      "WorkOS subdomain is required. " +
        "Set MCP_USE_OAUTH_WORKOS_SUBDOMAIN environment variable or pass subdomain in config."
    );
  }

  // Log which OAuth mode is being used
  if (clientId) {
    console.log("[WorkOS OAuth] Using pre-registered OAuth client mode");
    console.log(`[WorkOS OAuth]   - Client ID: ${clientId}`);
    console.log(
      "[WorkOS OAuth]   - Make sure this client exists in WorkOS Dashboard"
    );
    console.log(
      "[WorkOS OAuth]   - Configure redirect URIs to match your MCP client"
    );
  } else {
    console.log("[WorkOS OAuth] Using Dynamic Client Registration (DCR) mode");
    console.log(
      "[WorkOS OAuth]   - MCP clients will register themselves automatically"
    );
    console.log(
      "[WorkOS OAuth]   - Make sure DCR is enabled in WorkOS Dashboard"
    );
  }

  return new WorkOSOAuthProvider({
    provider: "workos",
    subdomain,
    clientId,
    apiKey,
    verifyJwt: config.verifyJwt,
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
  return new CustomOAuthProvider({
    provider: "custom",
    ...config,
  });
}
