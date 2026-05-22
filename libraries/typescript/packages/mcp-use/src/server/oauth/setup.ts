/**
 * OAuth Setup
 *
 * Handles OAuth provider/proxy initialization and configuration for MCP servers.
 * Supports both DCR-direct mode (OAuthProvider) and proxy mode (OAuthProxy).
 */

import type { Hono as HonoType } from "hono";
import { setupOAuthRoutes, isOAuthProxy } from "./routes.js";
import { createBearerAuthMiddleware } from "./middleware.js";
import type { OAuthProvider, OAuthProxy } from "./providers/types.js";

/**
 * Setup OAuth authentication for MCP server.
 *
 * Initializes OAuth provider/proxy, creates bearer auth middleware, sets up
 * OAuth routes, and applies auth to /mcp endpoints. Synchronous — registers
 * routes against the supplied Hono and returns immediately. baseUrl is a
 * lazy getter consumed inside request handlers, so this can run before the
 * HTTP listener has bound a port.
 *
 * Supports two modes:
 * - DCR-direct (OAuthProvider): Clients authenticate directly with upstream
 * - Proxy (OAuthProxy): Server proxies OAuth flow with pre-registered credentials
 *
 * @param rootApp - Underlying Hono app (the un-prefixed root view). Must NOT
 *                  be a `.basePath()` clone, because `.well-known/*` discovery
 *                  has to land at the literal host root (RFC 8414 §3.1) and
 *                  this function does its own basePath clone internally for
 *                  `/authorize`, `/token`, `/register`.
 * @param oauth - OAuth provider or proxy instance
 * @param getBaseUrl - Lazy getter for the server base URL. Called per-request.
 * @param basePath - Optional basePath prefix to scope authorize/token/register under
 */
export function setupOAuthForServer(
  rootApp: HonoType,
  oauth: OAuthProvider | OAuthProxy,
  getBaseUrl: () => string,
  basePath: string = ""
): void {
  const proxyMode = isOAuthProxy(oauth);
  console.log(`[OAuth] OAuth ${proxyMode ? "proxy" : "provider"} initialized`);

  // Create bearer auth middleware. The WWW-Authenticate `resource_metadata`
  // URL points at the path-aware discovery URL per RFC 9728 §3.1:
  // `<host>/.well-known/oauth-protected-resource<basePath>/mcp` — identifying
  // the MCP endpoint specifically as the protected resource. The matching
  // route is registered by `setupOAuthRoutes` on the root app.
  const middleware = createBearerAuthMiddleware(oauth, getBaseUrl, basePath);

  // Setup OAuth routes:
  // - /authorize, /token, /register live under `basePath`
  // - .well-known/* discovery lives at the host root
  setupOAuthRoutes(rootApp, oauth, getBaseUrl, basePath);

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
}
