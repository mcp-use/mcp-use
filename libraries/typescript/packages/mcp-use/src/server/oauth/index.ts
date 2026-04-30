/**
 * OAuth Integration for MCP Use
 *
 * Provides zero-config OAuth authentication for MCP servers with support for
 * Supabase, Auth0, Keycloak, WorkOS, custom OAuth providers, and OAuth proxy
 * for providers without DCR support (Google, GitHub, etc.).
 */

// Export types
export type { OAuthProvider, OAuthProxy, UserInfo } from "./providers/types.js";

// Export provider factory functions
export {
  oauthAuth0Provider,
  oauthBetterAuthProvider,
  oauthClerkProvider,
  oauthCustomProvider,
  oauthKeycloakProvider,
  oauthSupabaseProvider,
  oauthWorkOSProvider,
  type Auth0ProviderConfig,
  type BetterAuthProviderConfig,
  type ClerkProviderConfig,
  type CustomProviderConfig,
  type KeycloakProviderConfig,
  type SupabaseProviderConfig,
  type WorkOSProviderConfig,
} from "./providers.js";

// Export OAuth proxy factory for non-DCR providers
export {
  oauthProxy,
  jwksVerifier,
  type OAuthProxyConfig,
  type JwksVerifierConfig,
  type VerifyToken,
} from "./oauth-proxy.js";

// Export utilities
export { createBearerAuthMiddleware } from "./middleware.js";
export {
  setupOAuthRoutes,
  isOAuthProxy,
  createAuthorizeHandler,
  createTokenHandler,
} from "./routes.js";
export {
  getAuth,
  hasAnyScope,
  hasScope,
  requireAnyScope,
  requireScope,
} from "./utils.js";
export type { AuthInfo } from "./utils.js";

// Export setup
export { setupOAuthForServer, type OAuthSetupState } from "./setup.js";
