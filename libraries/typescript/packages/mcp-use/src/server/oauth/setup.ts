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
export interface OAuthSetupState {
  provider?: OAuthProvider | OAuthProxy;
  middleware?: (c: Context, next: Next) => Promise<Response | void>;
  complete: boolean;
}

/**
 * Options for OAuth setup
 */
export interface OAuthSetupOptions {
  /** When true, the landing page at /mcp is accessible without authentication */
  publicLandingPage?: boolean;
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
 * @param app - Hono app instance
 * @param oauth - OAuth provider or proxy instance
 * @param baseUrl - Server base URL for OAuth redirects
 * @param state - OAuth setup state to track completion
 * @returns Updated OAuth setup state with provider and middleware
 */
export async function setupOAuthForServer(
  app: HonoType,
  oauth: OAuthProvider | OAuthProxy,
  baseUrl: string,
  state: OAuthSetupState,
  options?: OAuthSetupOptions
): Promise<OAuthSetupState> {
  if (state.complete) {
    return state; // Already setup
  }

  const proxyMode = isOAuthProxy(oauth);
  console.log(`[OAuth] OAuth ${proxyMode ? "proxy" : "provider"} initialized`);

  // Create bearer auth middleware with baseUrl for WWW-Authenticate header
  let middleware = createBearerAuthMiddleware(oauth, baseUrl);

  // If publicLandingPage is enabled, wrap the middleware to skip auth for
  // browser GET requests to /mcp (the landing page)
  if (options?.publicLandingPage) {
    const originalMiddleware = middleware;
    middleware = async (c: Context, next: Next) => {
      // Check if this is a browser GET request to /mcp (landing page)
      if (
        c.req.method === "GET" &&
        c.req.path === "/mcp"
      ) {
        const accept = c.req.header("Accept") || "";
        // Detect browser: accepts HTML and not JSON/SSE
        const isBrowser =
          accept.includes("text/html") ||
          (!accept.includes("application/json") &&
            !accept.includes("text/event-stream"));
        if (isBrowser) {
          // Skip auth for public landing page
          return next();
        }
      }
      // All other requests require auth
      return originalMiddleware(c, next);
    };
    console.log("[OAuth] Landing page will be served without authentication");
  }

  // Setup OAuth routes
  setupOAuthRoutes(app, oauth, baseUrl);

  if (proxyMode) {
    console.log(
      "[OAuth] Proxy mode: clients use local /authorize, /token, /register endpoints"
    );
    console.log("[OAuth] Credentials will be injected at token exchange");
  } else {
    console.log(
      "[OAuth] Clients will authenticate with provider directly via DCR"
    );
  }
  console.log("[OAuth] Metadata endpoints: /.well-known/*");

  // Apply bearer auth to all /mcp routes
  app.use("/mcp/*", middleware);
  console.log("[OAuth] Bearer authentication enabled on /mcp routes");

  return {
    provider: oauth,
    middleware: middleware,
    complete: true,
  };
}
