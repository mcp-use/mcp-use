/**
 * Mango Agent Server
 * Main entry point for the Mango agent API server
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chatRoutes } from "./routes/chat.js";
import mcpRoutes from "./routes/mcp.js";
import filesRoutes from "./routes/files.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// Mount chat routes
app.route("/api/chat", chatRoutes);

// Mount MCP routes
app.route("/api/mcp", mcpRoutes);

// Mount file routes
app.route("/api/files", filesRoutes);

// Log all registered routes
console.log("📋 Registered routes:");
console.log("  - /api/chat/*");
console.log("  - /api/mcp/*");
console.log("  - /api/files/*");

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

// Start server
const port = parseInt(process.env.PORT || "3001", 10);

console.log(`🚀 Mango Agent Server starting on port ${port}...`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  process.exit(0);
});

// Start server using @hono/node-server
import { serve } from "@hono/node-server";

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`✅ Server running at http://localhost:${info.port}`);
    console.log(`📡 Health check: http://localhost:${info.port}/health`);
  }
);
