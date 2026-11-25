import type { Hono } from "hono";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { mountEventsInboxRoutes } from "./events/hook-routes.js";
import {
  openInboxFromEnv,
  type StorageEventsInbox,
} from "./events/inbox-store.js";
import { mountMcpProxy, mountOAuthProxy } from "./proxy/index.js";
import { getBundledSdkVersion, getInspectorVersion } from "./version.js";
import {
  INSPECTOR_API_RATE_LIMIT,
  INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
} from "./rate-limit.js";

export type InspectorProxyRoutesConfig = {
  /** URL passed to the client via config.json for auto-connect. */
  autoConnectUrl?: string | null;
  /** Explicit cross-origin callers of the OAuth BFF. Same-origin is implicit. */
  oauthProxyAllowedOrigins?: readonly string[];
  /** Allow the OAuth BFF to reach loopback servers in local development. */
  oauthProxyAllowLoopback?: boolean;
  /** Mount OAuth BFF routes (default true). */
  oauth?: boolean;
  /** Optional source label for logs when Inspector shares a dev server process. */
  logPrefix?: string;
  /**
   * MCP Events inbox store. Default: opened from `MCP_USE_STORAGE_URL`
   * (hosted, shared across replicas) or an in-process store.
   */
  eventsInbox?: StorageEventsInbox | Promise<StorageEventsInbox>;
  /** Public origin inbox callback URLs use (tunnel or hosted origin). */
  eventsPublicOrigin?: string;
  /** Dev token required to create inboxes (`mcp-use dev`). */
  devToken?: string;
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

  app.get(p("/inspector/health"), (c) => {
    return c.json({
      status: "ok",
      protocol: "mcp-use-inspector-preview",
      version: 1,
      capabilities: ["view-preview", "events-inbox"],
    });
  });

  app.get(p("/inspector/api/version"), (c) =>
    c.json({
      version: getInspectorVersion(),
      sdk: { bundled: getBundledSdkVersion() },
    })
  );

  mountEventsInboxRoutes(app, {
    basePath,
    inbox: config?.eventsInbox ?? openInboxFromEnv(),
    publicOrigin: config?.eventsPublicOrigin,
    devToken: config?.devToken,
    allowedOrigins: config?.oauthProxyAllowedOrigins,
  });

  mountMcpProxy(app, {
    path: p("/inspector/api/proxy"),
    allowLoopback,
    rateLimiter: apiRateLimiter,
    logPrefix: config?.logPrefix,
  });

  if (mountOAuth) {
    mountOAuthProxy(app, {
      basePath: p("/inspector/api/oauth"),
      callbackPath: p("/inspector/oauth/callback"),
      enableLogging: true,
      logPrefix: config?.logPrefix,
      allowedOrigins: config?.oauthProxyAllowedOrigins ?? [],
      allowLoopback,
      rateLimiter: apiRateLimiter,
    });
  }

  if (config?.autoConnectUrl !== undefined) {
    const autoConnectUrl = config.autoConnectUrl;
    app.get(p("/inspector/config.json"), (c) => {
      return c.json({ autoConnectUrl: autoConnectUrl ?? null });
    });
  }
}
