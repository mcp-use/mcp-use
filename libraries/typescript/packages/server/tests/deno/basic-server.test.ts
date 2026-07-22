import { MCPServer } from "mcp-use";
import { z } from "zod";
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.220.0/assert/mod.ts";

Deno.test("MCPServer registers the v2 surface in Deno", () => {
  const server = new MCPServer({
    name: "deno-smoke-test",
    version: "2.0.0",
    description: "Deno compatibility smoke test",
  });

  server.tool(
    {
      name: "echo",
      description: "Echo a message",
      inputSchema: z.object({ message: z.string() }),
    },
    async ({ message }) => ({
      content: [{ type: "text", text: message }],
    })
  );

  server.resource(
    {
      name: "example",
      uri: "test://example",
      description: "A static resource",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: "Example content" }],
    })
  );

  server.prompt(
    {
      name: "topic",
      description: "Ask about a topic",
      schema: z.object({ topic: z.string() }),
    },
    async ({ topic }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `Tell me about ${topic}` },
        },
      ],
    })
  );

  assertExists(server);
  assertEquals(server.basePath, "/mcp");
  assertEquals(typeof server.tool, "function");
  assertEquals(typeof server.resource, "function");
  assertEquals(typeof server.prompt, "function");
  assertEquals(typeof server.fetch, "function");
  assertEquals(typeof server.listen, "function");
});
