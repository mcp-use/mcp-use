/**
 * OAuth Setup
 *
 * Handles OAuth provider/proxy initialization and configuration for MCP servers.
 * Supports both DCR-direct mode (OAuthProvider) and proxy mode (OAuthProxy).
 */

import type { Hono as HonoType, Context, Next } from "hono";
import { setupOAuthRoutes, isOAuthProxy } from "./routes.js";
import { createBearerAuthMiddleware } from "./middleware.js";
import type { OAuthProvider, OAuthProxy } from "./providers/types.js";

/**
 * OAuth setup state
 */
interface OAuthSetupState {
  provider?: OAuthProvider | OAuthProxy;
  middleware?: (c: Context, next: Next) => Promise<Response | void>;
  complete: boolean;
}

/**
 * Setup OAuth authentication for MCP server
 *
 * Initializes OAuth provider/proxy, creates bearer auth middleware,
 * sets up OAuth routes, and applies auth to /mcp endpoints.
 *
 * Supports two modes:
 * - DCR-direct (OAuthProvider): Clients authenticate directly with upstream
 * - Proxy (OAuthProxy): Server proxies OAuth flow with pre-registered credentials
 *
 * @param rootApp - Underlying Hono app (the un-prefixed root view)
 * @param oauth - OAuth provider or proxy instance
 * @param baseUrl - Server base URL for OAuth redirects
 * @param state - OAuth setup state to track completion
 * @param basePath - Optional basePath prefix to scope authorize/token/register under
 * @returns Updated OAuth setup state with provider and middleware
 */
export async function setupOAuthForServer(
  rootApp: HonoType,
  oauth: OAuthProvider | OAuthProxy,
  baseUrl: string,
  state: OAuthSetupState,
  basePath: string = ""
): Promise<OAuthSetupState> {
  if (state.complete) {
    return state; // Already setup
  }

  const proxyMode = isOAuthProxy(oauth);
  console.log(`[OAuth] OAuth ${proxyMode ? "proxy" : "provider"} initialized`);

  // Create bearer auth middleware. The WWW-Authenticate `resource_metadata`
  // URL points at the host-root discovery path (RFC 9728 §5.1) so clients
  // hit the route mounted on the root app, independent of basePath.
  const middleware = createBearerAuthMiddleware(oauth, baseUrl);

  // Setup OAuth routes:
  // - /authorize, /token, /register live under `basePath`
  // - .well-known/* discovery lives at the host root
  setupOAuthRoutes(rootApp, oauth, baseUrl, basePath);

  // External (user-visible) paths for log messages.
  const externalAuthorize = `${basePath}/authorize`;
  const externalToken = `${basePath}/token`;
  const externalRegister = `${basePath}/register`;
  const externalMcp = `${basePath}/mcp`;
  const externalWellKnown = `/.well-known/*`;

  if (proxyMode) {
    console.log(
      `[OAuth] Proxy mode: clients use local ${externalAuthorize}, ${externalToken}, ${externalRegister} endpoints`
    );
    console.log("[OAuth] Credentials will be injected at token exchange");
  } else {
    console.log(
      "[OAuth] Clients will authenticate with provider directly via DCR"
    );
  }
  console.log(`[OAuth] Metadata endpoints: ${externalWellKnown}`);

  // Apply bearer auth to the MCP transport routes. Registered on a basePath
  // clone so the middleware path is prefixed automatically; both
  // `rootApp.basePath('/api').use('/mcp/*', mw)` and
  // `rootApp.use('/api/mcp/*', mw)` would work — using the clone keeps the
  // prefix concern out of this function.
  const app = basePath ? rootApp.basePath(basePath) : rootApp;
  app.use("/mcp/*", middleware);
  console.log(
    `[OAuth] Bearer authentication enabled on ${externalMcp}/* routes`
  );

  return {
    provider: oauth,
    middleware: middleware,
    complete: true,
  };
}
