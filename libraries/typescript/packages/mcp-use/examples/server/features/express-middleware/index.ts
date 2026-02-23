/**
 * Express Middleware Example
 *
 * Demonstrates using both Express and Hono middlewares with mcp-use server.
 * This example shows:
 * - Express middleware from npm packages (morgan, express-rate-limit)
 * - Hono middleware (c, next) signature
 * - MCP tool registration
 * - Custom GET route
 * - Custom POST route
 */

import { MCPServer, text, object } from "mcp-use/server";
import { z } from "zod";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

const server = new MCPServer({
  name: "express-middleware-example",
  title: "Express Middleware Example Server",
  version: "1.0.0",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
});

// ============================================================================
// EXPRESS MIDDLEWARE FROM NPM
// ============================================================================

// Morgan HTTP request logger middleware
const morganLogger = morgan("combined");

// Express rate limiter middleware
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});

// ============================================================================
// HONO MIDDLEWARE
// ============================================================================

const honoLogger = async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(
    `[Hono Middleware] ${c.req.method} ${c.req.path} - ${duration}ms`
  );
};

const honoTimer = async (c, next) => {
  c.set("startTime", Date.now());
  await next();
};

// ============================================================================
// MIDDLEWARE REGISTRATION
// ============================================================================

// Register Express middleware from npm (morgan logger)
server.use(morganLogger);

// Register Express middleware with path (rate limiter)
server.use("/api", apiLimiter);

// Register Hono middleware
server.use(honoLogger);

// Register Hono middleware with path
server.use("/api", honoTimer);

// ============================================================================
// MCP TOOL
// ============================================================================

server.tool(
  {
    name: "get-server-info",
    description: "Get server information including middleware count",
    schema: z.object({
      includeStats: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include statistics"),
    }),
  },
  async ({ includeStats }) => {
    return object({
      serverName: "express-middleware-example",
      version: "1.0.0",
      middlewares: {
        express: ["morgan", "express-rate-limit"],
        hono: ["honoLogger", "honoTimer"],
      },
      stats: includeStats
        ? {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage().heapUsed,
          }
        : undefined,
    });
  }
);

// ============================================================================
// CUSTOM ROUTES
// ============================================================================

// GET route - should work with both middleware types
server.get("/api/health", (c) => {
  const startTime = c.get("startTime");
  const duration = startTime ? Date.now() - startTime : 0;
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    duration,
  });
});

// POST route - should work with both middleware types
server.post("/api/data", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const startTime = c.get("startTime");
  const duration = startTime ? Date.now() - startTime : 0;

  return c.json({
    received: body,
    processed: true,
    timestamp: new Date().toISOString(),
    duration,
  });
});

// GET route without rate limiting (public route)
server.get("/public/info", (c) => {
  return c.json({
    message: "This is a public endpoint",
    server: "express-middleware-example",
  });
});

// ============================================================================
// START SERVER
// ============================================================================

console.log("Starting Express Middleware Example Server...");
console.log("This server demonstrates:");
console.log(
  "  - Express middleware from npm: morgan (logger), express-rate-limit"
);
console.log("  - Hono middleware: honoLogger, honoTimer");
console.log("  - MCP tool: get-server-info");
console.log("  - GET route: /api/health (rate limited), /public/info (public)");
console.log("  - POST route: /api/data (rate limited)");

server.listen();
