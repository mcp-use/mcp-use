/**
 * Redis Session Management Example
 *
 * Demonstrates persistent session storage with Redis so sessions survive
 * server restarts, deploys, and scaling events.
 *
 * Features:
 *   - RedisSessionStore for persistent session metadata
 *   - Session recovery after server restart (no client re-initialization needed)
 *   - Notifications that work across restarts once the client reconnects SSE
 *
 * Prerequisites:
 *   - A running Redis instance (set REDIS_URL env var)
 *   - npm install redis
 *
 * Usage:
 *   REDIS_URL=redis://localhost:6379 npx tsx src/server.ts
 */
import { MCPServer, text } from "mcp-use/server";
import { RedisSessionStore } from "mcp-use/server";
import { createClient } from "redis";
import z from "zod";

// ─── Redis Setup ─────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error("REDIS_URL environment variable is required.");
  console.error(
    "Example: REDIS_URL=redis://localhost:6379 npx tsx src/server.ts"
  );
  process.exit(1);
}

const redisClient = createClient({ url: REDIS_URL });
await redisClient.connect();
console.log("[Redis] Connected");

const sessionStore = new RedisSessionStore({
  client: redisClient,
  prefix: "mcp:session:",
  defaultTTL: 3600, // 1 hour
});

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new MCPServer({
  name: "redis-session-example",
  version: "1.0.0",
  description: "MCP server with Redis-backed session persistence",
  sessionStore,
});

// Simple tool — works before and after restart with the same session ID.
server.tool(
  {
    name: "echo",
    description: "Echoes back the input",
    schema: z.object({ message: z.string() }),
  },
  async ({ message }) => text(`Echo: ${message}`)
);

// Sends a custom notification to all connected clients.
// Useful for verifying that SSE streams work after session recovery.
server.tool(
  {
    name: "broadcast",
    description: "Sends a notification to all connected clients",
    schema: z.object({ message: z.string() }),
  },
  async ({ message }) => {
    const sessions = server.getActiveSessions();
    await server.sendNotification("custom/broadcast", {
      message,
      timestamp: new Date().toISOString(),
    });
    return text(`Broadcast sent to ${sessions.length} client(s): "${message}"`);
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || "3000", 10);
await server.listen(port);
