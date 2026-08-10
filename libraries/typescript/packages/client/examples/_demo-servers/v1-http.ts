/**
 * Minimal mcp-use legacy-era (2025 Streamable HTTP) demo server.
 *
 * mcp-use owns the transport and keeps this fixture aligned with the
 * repository's supported server API while still exercising legacy requests.
 *
 *   PORT=3101 pnpm v1
 */
import { MCPServer } from "mcp-use";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 3101);

const server = new MCPServer({
  name: "demo-v1",
  version: "1.0.0",
  legacy: "stateless",
});

server.tool(
  {
    name: "echo",
    description: "Echo a message back",
    inputSchema: z.object({
      message: z.string().describe("Text to echo"),
    }),
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `v1: ${message}` }],
  })
);

server.tool(
  {
    name: "add",
    description: "Add two numbers",
    inputSchema: z.object({
      a: z.number(),
      b: z.number(),
    }),
  },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }],
  })
);

const { url } = await server.listen(PORT, { host: "127.0.0.1" });
console.log(`[demo-v1] ${url} (mcp-use legacy mode)`);
