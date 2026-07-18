/**
 * End-to-end tests for MCP operation middleware and observer events.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { MCPServer } from "../src/index.js";

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const item = result.content.find(
    (block): block is { type: "text"; text: string } =>
      block.type === "text" && typeof block.text === "string"
  );
  if (item === undefined) {
    throw new Error("No text content in result");
  }
  return item.text;
}

describe("MCP middleware — integration", () => {
  let server: MCPServer;
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  const log: string[] = [];

  beforeAll(async () => {
    server = new MCPServer({
      name: "middleware-test-server",
      version: "1.0.0",
    });

    server.use("mcp:*", async (ctx, next) => {
      log.push(`before:${ctx.method}`);
      const result = await next();
      log.push(`after:${ctx.method}`);
      return result;
    });

    server.use("mcp:tools/call", async (ctx, next) => {
      ctx.state.set("mw-ran", true);
      return next();
    });

    server.use("mcp:tools/list", async (ctx, next) => {
      if (ctx.params.cursor !== undefined) {
        log.push(`tools/list:cursor:${ctx.params.cursor}`);
      }
      const tools = await next();
      return tools.filter((tool) => !tool.name.startsWith("_"));
    });

    server.on("mcp:tools/call:complete", (ctx, result) => {
      log.push(
        `event:${ctx.params.name}:${"isError" in result && result.isError === true ? "error" : "ok"}`
      );
    });

    server.tool(
      {
        name: "echo",
        inputSchema: z.object({ message: z.string() }),
      },
      async ({ message }) => ({
        content: [{ type: "text", text: message }],
      })
    );

    server.tool(
      {
        name: "_internal",
        inputSchema: z.object({}),
      },
      async () => ({
        content: [{ type: "text", text: "internal" }],
      })
    );

    server.tool(
      {
        name: "guarded",
        inputSchema: z.object({ secret: z.string() }),
      },
      async ({ secret }) => ({
        content: [
          {
            type: "text",
            text: secret === "correct" ? "access granted" : "Wrong secret",
          },
        ],
        ...(secret !== "correct" && { isError: true }),
      })
    );

    server.resource({ name: "greeting", uri: "greet://hello" }, async () => ({
      contents: [{ uri: "greet://hello", text: "Hello, World!" }],
    }));

    server.prompt(
      { name: "introduce", schema: z.object({ name: z.string() }) },
      async ({ name }) => ({
        messages: [
          {
            role: "user",
            content: { type: "text", text: `Hi, I'm ${name}!` },
          },
        ],
      })
    );

    const { url } = await server.listen(0);
    transport = new StreamableHTTPClientTransport(new URL(url));
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("catch-all middleware runs on tool calls", async () => {
    log.length = 0;
    await client.callTool({ name: "echo", arguments: { message: "hi" } });
    expect(log).toContain("before:tools/call");
    expect(log).toContain("after:tools/call");
  });

  it("complete events observe tool results", async () => {
    log.length = 0;
    await client.callTool({ name: "echo", arguments: { message: "x" } });
    expect(log).toContain("event:echo:ok");
  });

  it("tools/list middleware filters internal tools", async () => {
    log.length = 0;
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).not.toContain("_internal");
    expect(result.tools.map((tool) => tool.name)).toContain("echo");
    expect(log).toContain("before:tools/list");
    expect(log).toContain("after:tools/list");
  });

  it("tools/list middleware receives the validated request params", async () => {
    log.length = 0;
    await client.listTools({ cursor: "page-2" });
    expect(log).toContain("tools/list:cursor:page-2");
  });

  it("catch-all middleware runs on resources/list and prompts/list", async () => {
    log.length = 0;
    await client.listResources();
    await client.listPrompts();
    expect(log).toContain("before:resources/list");
    expect(log).toContain("before:prompts/list");
  });

  it("tool handler still returns the expected payload", async () => {
    const result = await client.callTool({
      name: "echo",
      arguments: { message: "hello-middleware" },
    });
    expect(textContent(result)).toBe("hello-middleware");
  });

  it("rejects registration after mount", () => {
    expect(() =>
      server.use("mcp:tools/call", async (_ctx, next) => next())
    ).toThrow(/after the server has started/);
    expect(() => server.on("mcp:tools/call", () => undefined)).toThrow(
      /after the server has started/
    );
  });
});

describe("MCP middleware — rejection", () => {
  let server: MCPServer;
  let client: Client;

  beforeAll(async () => {
    server = new MCPServer({
      name: "rejection-test-server",
      version: "1.0.0",
    });

    server.use("mcp:tools/call", async () => {
      throw new Error("Rejected by middleware");
    });

    server.tool({ name: "blocked", inputSchema: z.object({}) }, async () => ({
      content: [{ type: "text", text: "unexpected" }],
    }));

    const { url } = await server.listen(0);
    const transport = new StreamableHTTPClientTransport(new URL(url));
    client = new Client({ name: "rejection-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("returns an error result when middleware throws", async () => {
    const result = await client.callTool({ name: "blocked", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("Rejected by middleware");
  });
});

describe("MCP middleware — result validation", () => {
  it("does not send a malformed exact-method replacement", async () => {
    const server = new MCPServer({
      name: "invalid-result-test-server",
      version: "1.0.0",
    });
    server.use(
      "mcp:tools/call",
      // Deliberately bypass TypeScript to verify the SDK's runtime wire guard.
      async () => ({ invalid: true }) as never
    );
    server.tool({ name: "invalid", inputSchema: z.object({}) }, async () => ({
      content: [{ type: "text", text: "unexpected" }],
    }));

    const { url } = await server.listen(0);
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({
      name: "invalid-result-client",
      version: "1.0.0",
    });
    await client.connect(transport);

    try {
      const result = await client.callTool({
        name: "invalid",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain(
        "tools/call middleware returned an invalid result"
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("getHandler() framework mounting", () => {
  it("accepts a raw Request", async () => {
    const server = new MCPServer({ name: "handler-test", version: "1.0.0" });
    server.tool({ name: "ping", inputSchema: z.object({}) }, async () => ({
      content: [{ type: "text", text: "pong" }],
    }));

    const response = await server.getHandler()(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        }),
      })
    );

    expect(response.status).toBeLessThan(500);
  });

  it("duck-types Hono-style context objects", async () => {
    const server = new MCPServer({ name: "hono-test", version: "1.0.0" });
    const request = new Request("http://127.0.0.1/mcp", { method: "GET" });
    const response = await server.getHandler()({ req: { raw: request } });
    expect(response).toBeInstanceOf(Response);
  });
});

describe("getNodeHandler()", () => {
  it("returns a Node handler that serves MCP requests", async () => {
    const server = new MCPServer({ name: "node-test", version: "1.0.0" });
    server.tool({ name: "ping", inputSchema: z.object({}) }, async () => ({
      content: [{ type: "text", text: "pong" }],
    }));

    const { createServer } = await import("node:http");
    const nodeHandler = await server.getNodeHandler();
    const httpServer = createServer((req, res) => {
      void nodeHandler(req, res);
    });

    await new Promise<void>((resolve) =>
      httpServer.listen(0, "127.0.0.1", resolve)
    );
    const address = httpServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected TCP address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });

    expect(response.status).toBeLessThan(500);
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error ? reject(error) : resolve()))
    );
  });
});
