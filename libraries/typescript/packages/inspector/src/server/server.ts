import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import open from "open";
import { registerInspectorProxyRoutes } from "./proxy-routes.js";
import { isPortAvailable, parsePortFromArgs, hasNoOpenFlag } from "./utils.js";

const app = new Hono();
const isDev =
  process.env.NODE_ENV === "development" || process.env.VITE_DEV === "true";

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
  oauthProxyAllowedOrigins: isDev
    ? ["http://localhost:3000", "http://127.0.0.1:3000"]
    : [],
  oauthProxyAllowLoopback: isDev,
});

/**
 * Start the MCP Inspector API server (proxy + OAuth BFF only).
 * UI is served by Vite on :3000 during `pnpm dev`.
 */
async function startServer() {
  try {
    const cliPort = parsePortFromArgs();
    let port = cliPort ?? (isDev ? 3001 : 3000);
    const available = await isPortAvailable(port);

    if (!available) {
      if (cliPort !== null) {
        console.error(
          `❌ Port ${port} is not available. Please stop the process using this port and try again.`
        );
        process.exit(1);
      }

      if (isDev) {
        console.error(
          `❌ Port ${port} is not available (probably used by Vite dev server as fallback so you should stop port 3000). Please stop the process using this port and try again.`
        );
        process.exit(1);
      } else {
        const fallbackPort = 3002;
        console.warn(
          `⚠️  Port ${port} is not available, trying ${fallbackPort}`
        );
        const fallbackAvailable = await isPortAvailable(fallbackPort);

        if (!fallbackAvailable) {
          console.error(
            `❌ Neither port ${port} nor ${fallbackPort} is available. Please stop the processes using these ports and try again.`
          );
          process.exit(1);
        }

        port = fallbackPort;
      }
    }

    serve({
      fetch: app.fetch,
      port,
    });

    if (isDev) {
      console.warn(
        `🚀 MCP Inspector API server running on http://localhost:${port}`
      );
      console.warn(
        `🌐 Vite dev server should be running on http://localhost:3000`
      );
    } else {
      console.warn(`🚀 MCP Inspector running on http://localhost:${port}`);
    }

    if (process.env.NODE_ENV !== "production" && !hasNoOpenFlag()) {
      try {
        const url = isDev
          ? "http://localhost:3000"
          : `http://localhost:${port}`;
        await open(url);
        console.warn(`🌐 Browser opened automatically`);
      } catch {
        const url = isDev
          ? "http://localhost:3000"
          : `http://localhost:${port}`;
        console.warn(`🌐 Please open ${url} in your browser`);
      }
    }

    return { port, fetch: app.fetch };
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

export default { startServer };
