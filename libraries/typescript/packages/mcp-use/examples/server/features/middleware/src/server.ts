import { MCPServer, text, error } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "middleware-example",
  version: "1.0.0",
  description:
    "An MCP server demonstrating operation-level middleware with server.use('mcp:...')",
});

// ---------------------------------------------------------------------------
// 1. Logging middleware — fires for every MCP operation
//
// Pattern: 'mcp:*'  →  matches tools/call, tools/list, resources/read, etc.
// ---------------------------------------------------------------------------
server.use("mcp:*", async (ctx, next) => {
  const start = Date.now();
  console.log(`→ [${ctx.method}]`, JSON.stringify(ctx.params));
  const result = await next();
  console.log(`← [${ctx.method}] ${Date.now() - start}ms`);
  return result;
});

// ---------------------------------------------------------------------------
// 2. Auth guard — checks OAuth scopes before any tool call
//
// Pattern: 'mcp:tools/call'  →  exact match
//
// When OAuth is configured, ctx.auth is populated from the JWT.
// Without OAuth this middleware is a no-op (ctx.auth is undefined).
// ---------------------------------------------------------------------------
server.use("mcp:tools/call", async (ctx, next) => {
  if (ctx.auth) {
    const toolName = (ctx.params as { name?: string }).name ?? "";
    const required = `tools:call:${toolName}`;
    if (
      !ctx.auth.scopes.includes(required) &&
      !ctx.auth.scopes.includes("tools:*")
    ) {
      throw new Error(`Insufficient scope. Required: ${required}`);
    }
  }
  return next();
});

// ---------------------------------------------------------------------------
// 3. Per-session rate limiter — limits tool calls per session per minute
//
// Pattern: 'mcp:tools/call'  →  applies only to tool calls
//
// ctx.state can carry per-request data; for cross-request state use a Map
// outside the middleware (as shown here).
// ---------------------------------------------------------------------------
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 30; // max calls per minute per session

server.use("mcp:tools/call", async (ctx, next) => {
  const key = ctx.session?.sessionId ?? "anonymous";
  const now = Date.now();
  const windowStart = now - 60_000;

  const calls = (rateLimitMap.get(key) ?? []).filter((t) => t > windowStart);
  if (calls.length >= RATE_LIMIT) {
    throw new Error("Rate limit exceeded (30 calls/min)");
  }
  calls.push(now);
  rateLimitMap.set(key, calls);

  return next();
});

// ---------------------------------------------------------------------------
// 4. Tool-filter middleware — hides internal tools from the list
//
// Pattern: 'mcp:tools/list'  →  only fires when clients list tools
//
// The middleware receives the tools array from next() and can filter,
// sort, or enrich it before returning.
// ---------------------------------------------------------------------------
server.use("mcp:tools/list", async (_ctx, next) => {
  const result = (await next()) as any;

  // Handle both array and { tools: [...] } shapes
  const tools: any[] = Array.isArray(result) ? result : (result?.tools ?? []);

  const filtered = tools.filter((t: any) => !t.name.startsWith("_"));

  return Array.isArray(result) ? filtered : { ...result, tools: filtered };
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "greet",
    description: "Return a greeting for a given name",
    schema: z.object({
      name: z.string().describe("The name to greet"),
    }),
  },
  async ({ name }) => text(`Hello, ${name}!`)
);

server.tool(
  {
    name: "calculate",
    description: "Evaluate a simple arithmetic expression (a op b)",
    schema: z.object({
      a: z.number().describe("First operand"),
      op: z.enum(["+", "-", "*", "/"]).describe("Operator"),
      b: z.number().describe("Second operand"),
    }),
  },
  async ({ a, op, b }) => {
    if (op === "/" && b === 0) return error("Division by zero");
    const result =
      op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : a / b;
    return text(String(result));
  }
);

server.tool(
  {
    name: "fetch-data",
    description: "Simulates fetching external data (protected by scope guard)",
    schema: z.object({
      endpoint: z.string().describe("The endpoint to fetch from"),
    }),
  },
  async ({ endpoint }) => {
    // Simulate async work
    await new Promise((r) => setTimeout(r, 50));
    return text(`Data from ${endpoint}: { "status": "ok" }`);
  }
);

// Internal tool — hidden by the tools/list middleware
server.tool(
  {
    name: "_debug-sessions",
    description: "Internal debug tool (hidden from listing)",
    schema: z.object({}),
  },
  async () => text("Debug info: all sessions active")
);

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

await server.listen();
