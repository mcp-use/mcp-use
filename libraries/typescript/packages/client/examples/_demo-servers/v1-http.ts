/**
 * Minimal official-SDK v1 (2025 Streamable HTTP) demo server.
 * Stateful — initialize returns Mcp-Session-Id and the client opens the
 * session's long-lived GET/SSE stream.
 *
 *   PORT=3101 pnpm v1
 */
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import express from "express";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 3101);

function buildServer(): McpServer {
  const server = new McpServer({
    name: "demo-v1",
    version: "1.0.0",
  });

  server.registerTool(
    "echo",
    {
      description: "Echo a message back",
      inputSchema: {
        message: z.string().describe("Text to echo"),
      },
    },
    async ({ message }) => ({
      content: [{ type: "text", text: `v1: ${message}` }],
    })
  );

  server.registerTool(
    "add",
    {
      description: "Add two numbers",
      inputSchema: {
        a: z.number(),
        b: z.number(),
      },
    },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    })
  );

  return server;
}

const mcpApp = createMcpExpressApp({ host: "127.0.0.1" });

const sessions = new Map<
  string,
  { server: McpServer; transport: StreamableHTTPServerTransport }
>();

mcpApp.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    await sessions.get(sessionId)!.transport.handleRequest(req, res, req.body);
    return;
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { server, transport });
    },
  });
  transport.onclose = () => {
    const id = transport.sessionId;
    if (id) sessions.delete(id);
  };
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

mcpApp.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await sessions.get(sessionId)!.transport.handleRequest(req, res);
});

mcpApp.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await sessions.get(sessionId)!.transport.handleRequest(req, res);
});

// Outer app so CORS runs before createMcpExpressApp's own OPTIONS handling.
const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, mcp-session-id, mcp-protocol-version, authorization"
  );
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});
app.use(mcpApp);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[demo-v1] http://127.0.0.1:${PORT}/mcp (stateful)`);
});
