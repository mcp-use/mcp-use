/**
 * Integration test: getRequestContext() and ctx.auth propagation inside tool callbacks
 *
 * Regression test for #1183 / PR #1185: mountMcp() must wrap transport.handleRequest()
 * in runWithContext() so that AsyncLocalStorage is populated during MCP requests.
 * Without it, getRequestContext() returns undefined and ctx.auth (and any middleware-set
 * values on the Hono Context) are undefined in tool callbacks.
 *
 * This test verifies the AsyncLocalStorage path that session-isolation.test.ts does NOT
 * exercise (that test only checks ctx.client, which uses the closure-based path).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import {
  MCPServer,
  getRequestContext,
  object,
} from "../../src/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TEST_PORT = 3097;
const SERVER_URL = `http://localhost:${TEST_PORT}/mcp`;

// ---------------------------------------------------------------------------
// Helper: parse the structured JSON content returned by the tool
// ---------------------------------------------------------------------------

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): {
  hasRequestContext: boolean;
  authToken?: string;
} {
  const content = result.content as Array<{ type: string; text?: string }>;
  const textItem = content.find((c) => c.type === "text");
  if (!textItem?.text) throw new Error("No text content in result");
  return JSON.parse(textItem.text);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Request Context Propagation — getRequestContext and ctx.auth in tool callbacks", () => {
  let server: MCPServer;
  let client: Client;

  beforeAll(async () => {
    server = new MCPServer({
      name: "test-request-context-server",
      version: "1.0.0",
    });

    // Simulate OAuth middleware: set auth on the Hono Context before MCP routes
    server.app.use("/mcp", async (c, next) => {
      c.set("auth", { token: "test-token" });
      await next();
    });
    server.app.use("/sse", async (c, next) => {
      c.set("auth", { token: "test-token" });
      await next();
    });

    // Tool that reads from getRequestContext() and ctx.auth
    server.tool(
      {
        name: "check-context",
        description:
          "Returns whether getRequestContext() is defined and ctx.auth from the Hono Context",
        schema: z.object({}),
      },
      async () => {
        const requestContext = getRequestContext();
        const authToken = requestContext?.get("auth") as
          | { token?: string }
          | undefined;
        return object({
          hasRequestContext: requestContext !== undefined,
          authToken: authToken?.token,
        });
      }
    );

    await server.listen(TEST_PORT);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    await (server as any).close?.();
  });

  it("getRequestContext returns a valid Hono Context inside tool callback", async () => {
    const result = await client.callTool({
      name: "check-context",
      arguments: {},
    });
    const data = parseResult(result);
    expect(data.hasRequestContext).toBe(true);
  });

  it("ctx.auth (middleware-set value) is available in tool callback", async () => {
    const result = await client.callTool({
      name: "check-context",
      arguments: {},
    });
    const data = parseResult(result);
    expect(data.authToken).toBe("test-token");
  });

  describe("Concurrent calls — each request gets its own context", () => {
    it("concurrent tool calls both receive valid request context", async () => {
      const [result1, result2] = await Promise.all([
        client.callTool({ name: "check-context", arguments: {} }),
        client.callTool({ name: "check-context", arguments: {} }),
      ]);

      const data1 = parseResult(result1);
      const data2 = parseResult(result2);

      expect(data1.hasRequestContext).toBe(true);
      expect(data1.authToken).toBe("test-token");
      expect(data2.hasRequestContext).toBe(true);
      expect(data2.authToken).toBe("test-token");
    });
  });
});
