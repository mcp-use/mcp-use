/**
 * Runtime check that middleware receives a populated `client` context.
 * The type test in middleware-client-type.test.ts only covers the declaration.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { MCPServer } from "../src/index.js";

describe("MiddlewareContext client at runtime", () => {
  let server: MCPServer;
  let client: Client;
  const seen: Array<{ method: string; infoType: string; canType: string }> = [];

  beforeAll(async () => {
    server = new MCPServer({ name: "client-ctx-server", version: "1.0.0" });
    server.use("mcp:*", async (ctx, next) => {
      seen.push({
        method: ctx.method,
        infoType: typeof ctx.client.info(),
        canType: typeof ctx.client.can,
      });
      return next();
    });
    server.tool(
      { name: "echo", inputSchema: z.object({ message: z.string() }) },
      async ({ message }) => ({ content: [{ type: "text", text: message }] })
    );
    const { url } = await server.listen(0);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("lets middleware call ctx.client.info() on tools/list and tools/call", async () => {
    await client.listTools();
    await client.callTool({ name: "echo", arguments: { message: "hi" } });
    for (const method of ["tools/list", "tools/call"]) {
      const entry = seen.find((item) => item.method === method);
      expect(entry).toEqual({
        method,
        infoType: "object",
        canType: "function",
      });
    }
  });
});
