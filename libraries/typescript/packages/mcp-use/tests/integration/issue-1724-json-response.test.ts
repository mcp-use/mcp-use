import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { MCPServer } from "../../src/server/index.js";
import { text } from "../../src/server/utils/response-helpers.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TEST_PORT = 3095;
const SERVER_URL = `http://localhost:${TEST_PORT}/mcp`;

describe("Issue #1724 - Stateful transport should return tool results in POST response (not SSE)", () => {
  let server: MCPServer;

  beforeAll(async () => {
    server = new MCPServer({
      name: "issue-1724-test-server",
      version: "1.0.0",
    });

    server.tool(
      {
        name: "hello",
        description: "Says hello",
        schema: z.object({
          name: z.string(),
        }),
      },
      async ({ name }) => {
        return text(`Hello, ${name}!`);
      }
    );

    await server.listen(TEST_PORT);
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  afterAll(async () => {
    await (server as any).close?.();
  });

  it("should return tool result via POST (not hang waiting for SSE)", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      {}
    );

    try {
      await client.connect(transport);

      const result = await client.callTool(
        { name: "hello", arguments: { name: "world" } },
        undefined,
        { timeout: 5000 }
      );

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      const textContent = (result.content as Array<{ type: string; text?: string }>)
        .find((c) => c.type === "text");
      expect(textContent?.text).toBe("Hello, world!");
    } finally {
      await client.close();
    }
  });

  it("should handle concurrent tool calls without hanging", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      {}
    );

    try {
      await client.connect(transport);

      const results = await Promise.all([
        client.callTool(
          { name: "hello", arguments: { name: "alice" } },
          undefined,
          { timeout: 5000 }
        ),
        client.callTool(
          { name: "hello", arguments: { name: "bob" } },
          undefined,
          { timeout: 5000 }
        ),
      ]);

      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
      }
    } finally {
      await client.close();
    }
  });

  it("POST response should be 200 (JSON) not 202 (SSE deferred)", async () => {
    const sessionId = await initializeSession();

    const response = await makeToolCallRequest(TEST_PORT, sessionId);

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.result).toBeDefined();
    expect(body.result.content).toBeDefined();
  });
});

async function initializeSession(): Promise<string> {
  const initRequest = {
    jsonrpc: "2.0",
    id: "1",
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    },
  };

  const initResponse = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(initRequest),
  });

  const sessionId = initResponse.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("No session ID in response");

  await fetch(`http://localhost:${TEST_PORT}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });

  return sessionId;
}

async function makeToolCallRequest(port: number, sessionId: string): Promise<Response> {
  return fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "2",
      method: "tools/call",
      params: {
        name: "hello",
        arguments: { name: "world" },
      },
    }),
  });
}
