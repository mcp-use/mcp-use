import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { registerInspectorProxyRoutes } from "./proxy-routes.js";

/** Hono app for inspector dev API routes (MCP proxy + OAuth BFF). */
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
        "X-Server-Id",
        "X-Requested-With",
      ],
      exposeHeaders: ["*"],
    })
  );

  app.use("/inspector/api/*", logger());

  registerInspectorProxyRoutes(app, {
    oauthProxyAllowedOrigins: [],
    oauthProxyAllowLoopback: true,
  });

  return app;
}
