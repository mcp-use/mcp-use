/**
 * OAuth Setup
 *
 * Handles OAuth provider initialization and configuration for MCP servers.
 */

import type { Hono as HonoType, Context, Next } from "hono";
import { setupOAuthRoutes } from "./routes.js";
import { createBearerAuthMiddleware } from "./middleware.js";
import type { OAuthProvider } from "./providers/types.js";

/**
 * OAuth setup state
 */
export interface OAuthSetupState {
  provider?: OAuthProvider;
  middleware?: (c: Context, next: Next) => Promise<Response | void>;
  complete: boolean;
}

/**
 * Setup OAuth authentication for MCP server
 *
 * Initializes OAuth provider, creates bearer auth middleware,
 * sets up OAuth routes, and applies auth to /mcp endpoints.
 *
 * @param app - Hono app instance
 * @param oauthProvider - OAuth provider instance
 * @param baseUrl - Server base URL for OAuth redirects
 * @param state - OAuth setup state to track completion
 * @returns Updated OAuth setup state with provider and middleware
 */
export async function setupOAuthForServer(
  app: HonoType,
  oauthProvider: OAuthProvider,
  baseUrl: string,
  state: OAuthSetupState
): Promise<OAuthSetupState> {
  if (state.complete) {
    return state; // Already setup
  }

  console.log(`[OAuth] OAuth provider initialized`);

  // Create bearer auth middleware with baseUrl for WWW-Authenticate header
  const middleware = createBearerAuthMiddleware(oauthProvider, baseUrl);

  // Setup OAuth routes
  setupOAuthRoutes(app, oauthProvider, baseUrl);

  const mode = oauthProvider.getMode?.() || "proxy";
  if (mode === "direct") {
    console.log(
      "[OAuth] Direct mode: Clients will authenticate with provider directly"
    );
    console.log("[OAuth] Metadata endpoints: /.well-known/*");
  } else {
    console.log(
      "[OAuth] Proxy mode: Routes at /authorize, /token, /.well-known/*"
    );
  }

  // Apply bearer auth to all /mcp routes
  app.use("/mcp/*", middleware);
  console.log("[OAuth] Bearer authentication enabled on /mcp routes");

  return {
    provider: oauthProvider,
    middleware: middleware,
    complete: true,
  };
}
