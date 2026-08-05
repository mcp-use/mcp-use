/**
 * Minimal mcp-use v2 Streamable HTTP demo server.
 *
 *   PORT=3102 pnpm v2
 *   PORT=3102 LEGACY=reject pnpm v2
 */
import { MCPServer } from "mcp-use";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 3102);
const LEGACY = process.env.LEGACY ?? "stateless";

if (LEGACY !== "stateless" && LEGACY !== "reject") {
  throw new Error('LEGACY must be either "stateless" or "reject"');
}

const server = new MCPServer({
  name: "demo-v2",
  version: "1.0.0",
  legacy: LEGACY,
});

server.tool(
  {
    name: "echo",
    description: "Echo a message back",
    inputSchema: z.object({
      message: z.string().describe("Text to echo"),
    }),
  },
  ({ message }) => ({
    content: [{ type: "text", text: `v2: ${message}` }],
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
  ({ a, b }) => ({
    content: [{ type: "text", text: `v2: ${a + b}` }],
  })
);

const { url } = await server.listen(PORT, { host: "127.0.0.1" });
console.log(`[demo-v2] ${url} (legacy: ${LEGACY})`);
