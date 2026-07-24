/**
 * Minimal official-SDK v2 (2026-07-28) Streamable HTTP demo server.
 * Uses @modelcontextprotocol/server + createMcpHandler.
 *
 *   PORT=3102 pnpm v2
 *   PORT=3102 LEGACY=reject pnpm v2
 */
import { serve } from "@hono/node-server";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 3102);
const LEGACY = process.env.LEGACY ?? "stateless";

if (LEGACY !== "stateless" && LEGACY !== "reject") {
  throw new Error('LEGACY must be either "stateless" or "reject"');
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: "demo-v2",
    version: "1.0.0",
  });

  server.registerTool(
    "echo",
    {
      description: "Echo a message back",
      inputSchema: z.object({
        message: z.string().describe("Text to echo"),
      }),
    },
    ({ message }) => ({
      content: [{ type: "text", text: `v2: ${message}` }],
    })
  );

  server.registerTool(
    "add",
    {
      description: "Add two numbers",
      inputSchema: z.object({
        a: z.number(),
        b: z.number(),
      }),
    },
    ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    })
  );

  return server;
}

const app = new Hono();
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "content-type",
      "mcp-method",
      "mcp-name",
      "mcp-session-id",
      "mcp-protocol-version",
      "authorization",
    ],
    exposeHeaders: ["mcp-session-id"],
  })
);
const handler = createMcpHandler(buildServer, { legacy: LEGACY });
app.all("/mcp", (c) => handler.fetch(c.req.raw));

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(
    `[demo-v2] http://127.0.0.1:${info.port}/mcp (legacy: ${LEGACY})`
  );
});
