/**
 * OAuth Setup
 *
 * Handles OAuth provider/proxy initialization and configuration for MCP servers.
 * Supports both DCR-direct mode (OAuthProvider) and proxy mode (OAuthProxy).
 */

import type { Hono as HonoType, Context, Next } from "hono";
import { isBrowserLandingRequest } from "../landing.js";
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
 * @param app - Hono app instance
 * @param oauth - OAuth provider or proxy instance
 * @param baseUrl - Server base URL for OAuth redirects
 * @param state - OAuth setup state to track completion
 * @returns Updated OAuth setup state with provider and middleware
 */
interface SetupOAuthForServerOptions {
  publicLandingPage?: boolean;
  /**
   * Normalized server-wide path prefix (see `config/base-path.ts`). The MCP
   * transport, OAuth endpoints, and the landing-page exemption are all scoped
   * under this prefix. `""` means root-mounted. Defaults to `/mcp` for
   * backward compatibility when callers don't thread it.
   */
  basePath?: string;
}

export async function setupOAuthForServer(
  app: HonoType,
  oauth: OAuthProvider | OAuthProxy,
  baseUrl: string,
  state: OAuthSetupState,
  options?: SetupOAuthForServerOptions
): Promise<OAuthSetupState> {
  if (state.complete) {
    return state; // Already setup
  }

  const basePath = options?.basePath ?? "/mcp";
  // The transport mounts at the exact basePath (or "/" when root-mounted).
  const transportPath = basePath === "" ? "/" : basePath;
  const ssePath = `${basePath}/sse`;

  const proxyMode = isOAuthProxy(oauth);
  console.log(`[OAuth] OAuth ${proxyMode ? "proxy" : "provider"} initialized`);

  // Create bearer auth middleware with baseUrl for WWW-Authenticate header
  let middleware = createBearerAuthMiddleware(oauth, baseUrl);

  // Setup OAuth routes
  setupOAuthRoutes(app, oauth, baseUrl, basePath);

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

  if (options?.publicLandingPage) {
    const bearerMiddleware = middleware;
    middleware = (c: Context, next: Next) => {
      const acceptHeader = c.req.header("Accept") || "";
      if (
        c.req.path === transportPath &&
        isBrowserLandingRequest(c.req.method, acceptHeader)
      ) {
        return next();
      }

      return bearerMiddleware(c, next);
    };
  }

  // Apply bearer auth ONLY to the exact MCP transport paths. The Streamable-HTTP
  // handler is a single endpoint per path (no deeper subpaths), mounted at the
  // exact basePath and `${basePath}/sse` (see endpoints/mount-mcp.ts). We must
  // NOT use `${basePath}/*` here: that wildcard would also trap the PUBLIC
  // assets served under `${basePath}/mcp-use/*` and the OAuth endpoints under
  // `${basePath}/oauth/*`, requiring a bearer token for resources that must
  // stay open. Guarding the exact transport paths keeps assets/OAuth public
  // while protecting the protocol traffic.
  app.use(transportPath, middleware);
  app.use(ssePath, middleware);
  console.log(
    `[OAuth] Bearer authentication enabled on ${transportPath} and ${ssePath} routes`
  );

  return {
    provider: oauth,
    middleware: middleware,
    complete: true,
  };
}
