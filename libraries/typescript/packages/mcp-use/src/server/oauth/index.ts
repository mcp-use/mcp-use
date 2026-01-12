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
  oauthAuth0Provider,
  oauthCustomProvider,
  oauthKeycloakProvider,
  oauthSupabaseProvider,
  oauthWorkOSProvider,
  type Auth0ProviderConfig,
  type CustomProviderConfig,
  type KeycloakProviderConfig,
  type SupabaseProviderConfig,
  type WorkOSProviderConfig,
} from "./providers.js";

// Export utilities
export { createBearerAuthMiddleware } from "./middleware.js";
export { setupOAuthRoutes } from "./routes.js";
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
