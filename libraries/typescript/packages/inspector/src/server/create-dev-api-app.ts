import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerInspectorProxyRoutes } from "./proxy-routes.js";
import { INSPECTOR_RELAY_CAPABILITY_HEADER } from "./relay-auth.js";

/**
 * Hono app for the Inspector's local development API routes.
 *
 * This wrapper intentionally permits wildcard CORS and loopback targets for
 * local tooling. Hosted or production relays must use `registerInspectorProxyRoutes`
 * or `mountInspector` with explicit origins, authentication, and deployment
 * policy instead of promoting this dev-only wrapper.
 */
export function createDevApiApp(): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "Accept",
        "X-Target-URL",
        "X-MCP-Target",
        "Mcp-Session-Id",
        "mcp-session-id",
        "mcp-protocol-version",
        "Mcp-Protocol-Version",
        "Mcp-Method",
        "Mcp-Name",
        "DPoP",
        INSPECTOR_RELAY_CAPABILITY_HEADER,
        "Last-Event-ID",
        "X-Server-Id",
        "X-Requested-With",
      ],
      exposeHeaders: ["*"],
    })
  );

  registerInspectorProxyRoutes(app, {
    oauthProxyAllowedOrigins: [],
    oauthProxyAllowLoopback: true,
  });

  return app;
}
