import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import open from "open";
// import { chatRoutes } from "./routes/chat.js"; // Old agent - deprecated
import { chatRoutesV2 } from "./routes/chat-v2.js";
import { mcpRoutes } from "./routes/mcp.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { anthropicProxyRoutes } from "./routes/anthropic-proxy.js";
import { registerStaticRoutes } from "./static.js";
import { findAvailablePort, isPortAvailable } from "./utils.js";

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Register API routes
// app.route("/api/chat", chatRoutes); // Old agent - deprecated, use v2
app.route("/api/chat/v2", chatRoutesV2);
app.route("/api/mcp", mcpRoutes);
app.route("/api/workspace", workspaceRoutes);
app.route("/api/anthropic-proxy", anthropicProxyRoutes);

// Health check
app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Register static file serving (must be last)
registerStaticRoutes(app);

/**
 * Start the Mango server
 */
export async function startServer(startPort = 5176) {
  try {
    const isDev =
      process.env.NODE_ENV === "development" || process.env.VITE_DEV === "true";

    let port = startPort;

    if (isDev) {
      // In dev mode, use fixed port for API server
      const available = await isPortAvailable(port);
      if (!available) {
        console.error(
          `❌ Port ${port} is not available. Please stop the process using this port.`
        );
        process.exit(1);
      }
    } else {
      // In production, find available port
      port = await findAvailablePort(port);
    }

    serve({
      fetch: app.fetch,
      port,
    });

    if (isDev) {
      console.log(`🥭 Mango API server running on http://localhost:${port}`);
      console.log(
        `🌐 Vite dev server should be running on http://localhost:5175`
      );
    } else {
      console.log(`🥭 Mango running on http://localhost:${port}`);

      // Auto-open browser in standalone mode
      try {
        await open(`http://localhost:${port}`);
        console.log(`🌐 Browser opened`);
      } catch {
        console.log(`🌐 Please open http://localhost:${port} in your browser`);
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
