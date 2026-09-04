import type { Context, Hono } from "hono";
import { RateLimiterMemory } from "rate-limiter-flexible";
import {
  mountMcpProxy,
  mountOAuthProxy,
  type OAuthProxyConfidentialClientResolver,
  type OAuthProxyStateStore,
} from "./proxy/index.js";
import {
  INSPECTOR_API_RATE_LIMIT,
  INSPECTOR_GLOBAL_API_RATE_LIMIT,
  INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
} from "./rate-limit.js";

export type InspectorProxyRoutesConfig = {
  /** URL passed to the client via config.json for auto-connect. */
  autoConnectUrl?: string | null;
  /** Explicit cross-origin callers of the OAuth BFF. Same-origin is implicit. */
  oauthProxyAllowedOrigins?: readonly string[];
  /** Explicit cross-origin callers of the MCP CORS proxy. */
  mcpProxyAllowedOrigins?: readonly string[];
  /** Allow the OAuth BFF to reach loopback servers in local development. */
  oauthProxyAllowLoopback?: boolean;
  /** Mount OAuth BFF routes (default true). */
  oauth?: boolean;
  /** Optional source label for logs when Inspector shares a dev server process. */
  logPrefix?: string;
  /** Mount MCP CORS proxy routes (default true). */
  mcp?: boolean;
  /** Durable state shared by every OAuth proxy replica. */
  oauthProxyStateStore?: OAuthProxyStateStore;
  /** Server-side provider configuration for confidential OAuth clients. */
  oauthProxyConfidentialClientResolver?: OAuthProxyConfidentialClientResolver;
  /** Authentication boundary for the product relay (upstream Authorization is separate). */
  authenticate?: (c: Context) => Promise<boolean> | boolean;
};

/**
 * Register minimal inspector backend routes: health, MCP CORS proxy, OAuth BFF.
 */
export function registerInspectorProxyRoutes(
  app: Hono,
  config?: InspectorProxyRoutesConfig,
  basePath: string = ""
) {
  const p = (suffix: string) => `${basePath}${suffix}`;
  const allowLoopback = config?.oauthProxyAllowLoopback ?? false;
  const mountOAuth = config?.oauth !== false;
  const apiRateLimiter = new RateLimiterMemory({
    points: INSPECTOR_API_RATE_LIMIT,
    duration: INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
  });
  const globalRateLimiter = new RateLimiterMemory({
    points: INSPECTOR_GLOBAL_API_RATE_LIMIT,
    duration: INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
  });

  app.get(p("/inspector/health"), async (c) => {
    if (config?.oauthProxyStateStore?.ready) {
      try {
        await Promise.race([
          config.oauthProxyStateStore.ready(),
          healthTimeout(1_000),
        ]);
      } catch {
        return c.json({ status: "unavailable" }, 503);
      }
    }
    return c.json({
      status: "ok",
      protocol: "mcp-use-inspector-preview",
      version: 1,
      capabilities: ["view-preview"],
    });
  });

  if (config?.mcp !== false) {
    mountMcpProxy(app, {
      path: p("/inspector/api/proxy"),
      allowLoopback,
      rateLimiter: apiRateLimiter,
      globalRateLimiter,
      logPrefix: config?.logPrefix,
      allowedOrigins: config?.mcpProxyAllowedOrigins,
      authenticate: config?.authenticate,
    });
  }

  if (mountOAuth) {
    mountOAuthProxy(app, {
      basePath: p("/inspector/api/oauth"),
      callbackPath: p("/inspector/oauth/callback"),
      enableLogging: true,
      logPrefix: config?.logPrefix,
      allowedOrigins: config?.oauthProxyAllowedOrigins ?? [],
      allowLoopback,
      rateLimiter: apiRateLimiter,
      globalRateLimiter,
      stateStore: config?.oauthProxyStateStore,
      resolveConfidentialClient: config?.oauthProxyConfidentialClientResolver,
      authenticate: config?.authenticate,
    });
  }

  if (config?.autoConnectUrl !== undefined) {
    const autoConnectUrl = config.autoConnectUrl;
    app.get(p("/inspector/config.json"), (c) => {
      return c.json({ autoConnectUrl: autoConnectUrl ?? null });
    });
  }
}

function healthTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error("Inspector state store readiness timeout")),
      ms
    )
  );
}
