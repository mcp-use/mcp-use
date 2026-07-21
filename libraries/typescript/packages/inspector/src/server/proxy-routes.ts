import type { Hono } from "hono";
import { mountMcpProxy, mountOAuthProxy } from "./proxy/index.js";

export type InspectorProxyRoutesConfig = {
  /** URL passed to the client via config.json for auto-connect. */
  autoConnectUrl?: string | null;
  /** Explicit cross-origin callers of the OAuth BFF. Same-origin is implicit. */
  oauthProxyAllowedOrigins?: readonly string[];
  /** Allow the OAuth BFF to reach loopback servers in local development. */
  oauthProxyAllowLoopback?: boolean;
  /** Mount OAuth BFF routes (default true). */
  oauth?: boolean;
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

  app.get(p("/inspector/health"), (c) => {
    return c.json({
      status: "ok",
      protocol: "mcp-use-inspector-preview",
      version: 1,
      capabilities: ["view-preview"],
    });
  });

  mountMcpProxy(app, {
    path: p("/inspector/api/proxy"),
    allowLoopback,
  });

  if (mountOAuth) {
    mountOAuthProxy(app, {
      basePath: p("/inspector/api/oauth"),
      callbackPath: p("/inspector/oauth/callback"),
      enableLogging: true,
      allowedOrigins: config?.oauthProxyAllowedOrigins ?? [],
      allowLoopback,
    });
  }

  if (config?.autoConnectUrl !== undefined) {
    const autoConnectUrl = config.autoConnectUrl;
    app.get(p("/inspector/config.json"), (c) => {
      return c.json({ autoConnectUrl: autoConnectUrl ?? null });
    });
  }
}
