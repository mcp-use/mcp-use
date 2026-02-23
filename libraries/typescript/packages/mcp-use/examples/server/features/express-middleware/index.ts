/**
 * Express Middleware Example
 * 
 * Demonstrates using both Express and Hono middlewares with mcp-use server.
 * This example shows:
 * - Express middleware (req, res, next) signature
 * - Hono middleware (c, next) signature
 * - MCP tool registration
 * - Custom GET route
 * - Custom POST route
 */

import { MCPServer, text, object } from "mcp-use/server";
import { z } from "zod";

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
// EXPRESS MIDDLEWARE
// ============================================================================

// Express middleware: (req, res, next) => void
const expressLogger = (req: any, res: any, next: () => void) => {
  console.log(`[Express Middleware] ${req.method} ${req.url}`);
  next();
};

// Express middleware with path
const expressAuth = (req: any, res: any, next: () => void) => {
  const token = req.headers.authorization;
  if (!token) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  next();
};

// Express error middleware: (err, req, res, next) => void
const expressErrorHandler = (err: any, req: any, res: any, next: () => void) => {
  console.error("[Express Error Handler]", err);
  res.statusCode = 500;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "Internal Server Error" }));
};

// ============================================================================
// HONO MIDDLEWARE
// ============================================================================

// Hono middleware: (c, next) => Promise<Response | void>
const honoLogger = async (c: any, next: any) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(`[Hono Middleware] ${c.req.method} ${c.req.path} - ${duration}ms`);
};

const honoTimer = async (c: any, next: any) => {
  c.set("startTime", Date.now());
  await next();
};

// ============================================================================
// MIDDLEWARE REGISTRATION
// ============================================================================

// Register Express middleware (should not have type errors)
server.use(expressLogger);

// Register Express middleware with path
server.use("/api", expressAuth);

// Register Hono middleware
server.use(honoLogger);

// Register Hono middleware with path
server.use("/api", honoTimer);

// Register Express error middleware
server.use(expressErrorHandler);

// ============================================================================
// MCP TOOL
// ============================================================================

server.tool(
  {
    name: "get-server-info",
    description: "Get server information including middleware count",
    schema: z.object({
      includeStats: z.boolean().optional().default(false).describe("Include statistics"),
    }),
  },
  async ({ includeStats }) => {
    return object({
      serverName: "express-middleware-example",
      version: "1.0.0",
      middlewares: {
        express: ["expressLogger", "expressAuth", "expressErrorHandler"],
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

// GET route without Express auth middleware (public route)
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
console.log("  - Express middleware: expressLogger, expressAuth, expressErrorHandler");
console.log("  - Hono middleware: honoLogger, honoTimer");
console.log("  - MCP tool: get-server-info");
console.log("  - GET route: /api/health (protected), /public/info (public)");
console.log("  - POST route: /api/data (protected)");

server.listen();
