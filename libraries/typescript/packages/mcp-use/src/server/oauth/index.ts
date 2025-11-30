/**
 * OAuth Integration for MCP Use
 *
 * Provides zero-config OAuth authentication for MCP servers with support for
 * Supabase, Auth0, Keycloak, WorkOS, and custom OAuth providers.
 */

// Export types
export type { OAuthProvider, UserInfo } from "./providers/types.js";

// Export provider factory functions
export {
  oauthSupabaseProvider,
  oauthAuth0Provider,
  oauthKeycloakProvider,
  oauthWorkOSProvider,
  oauthCustomProvider,
  type SupabaseProviderConfig,
  type Auth0ProviderConfig,
  type KeycloakProviderConfig,
  type WorkOSProviderConfig,
  type CustomProviderConfig,
} from "./providers.js";

// Export utilities
export { createBearerAuthMiddleware } from "./middleware.js";
export { setupOAuthRoutes } from "./routes.js";
export {
  getAuth,
  hasScope,
  hasAnyScope,
  requireScope,
  requireAnyScope,
} from "./utils.js";
export type { AuthInfo } from "./utils.js";
