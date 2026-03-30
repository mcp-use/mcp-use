import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import open from "open";
import { registerInspectorRoutes } from "./shared-routes.js";
import { registerStaticRoutesWithDevProxy } from "./shared-static.js";
import { setServerPort } from "./tunnel.js";
import { isPortAvailable, parsePortFromArgs, hasNoOpenFlag } from "./utils.js";

const app = new Hono();

// Middleware - expose mcp-session-id for cross-origin requests (FastMCP session management)
// NOTE: Authorization must be listed explicitly in allowHeaders — the wildcard * does NOT cover it
// per the Fetch spec. Without this, browsers block requests with Authorization headers.
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
      "X-Connection-URL",
    ],
    exposeHeaders: ["*"],
  })
);

// Apply logger middleware to API routes for request/response logging.
// Filter out noisy endpoints (telemetry, RPC stream/log) to reduce log spam.
const noisyPaths = [
  "/inspector/api/tel/",
  "/inspector/api/rpc/stream",
  "/inspector/api/rpc/log",
];
app.use(
  "/inspector/api/*",
  logger((message, ...rest) => {
    if (noisyPaths.some((p) => message.includes(p))) return;
    console.log(message, ...rest);
  })
);

// Register all API routes
registerInspectorRoutes(app);

// Register static file serving with dev proxy support (must be last as it includes catch-all route)
registerStaticRoutesWithDevProxy(app);

/**
 * Start the MCP Inspector HTTP server and return its listening port and fetch handler.
 *
 * Starts the Hono app on an available port (prefers a CLI-specified port, otherwise 3001;
 * in standalone/production mode it will fall back to 3002 if 3001 is unavailable),
 * logs server status, and attempts to open the browser when not running in production.
 * On unrecoverable startup failures (for example, requested ports unavailable), the process
 * will exit with code 1.
 *
 * @returns An object containing the resolved `port` number and the application's `fetch` handler.
 */
async function startServer() {
  try {
    // In development mode, use port 3001 for API server
    // In production/standalone mode, try 3001 first, then 3002 as fallback
    const isDev =
      process.env.NODE_ENV === "development" || process.env.VITE_DEV === "true";

    // Check for port from command line arguments first
    const cliPort = parsePortFromArgs();
    let port = cliPort ?? (isDev ? 3001 : 3000);
    const available = await isPortAvailable(port);

    if (!available) {
      // If port was explicitly specified via CLI, fail immediately
      if (cliPort !== null) {
        console.error(
          `❌ Port ${port} is not available. Please stop the process using this port and try again.`
        );
        process.exit(1);
      }

      if (isDev) {
        console.error(
          `❌❌❌ Port ${port} is not available (probably used by Vite dev server as fallback so you should stop port 3000). Please stop the process using this port and try again.`
        );
        process.exit(1);
      } else {
        // In standalone mode, try fallback port
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

    setServerPort(port);

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

    // Auto-open browser in development (unless --no-open flag is present)
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

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

export default { startServer };
