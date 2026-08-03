import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({ name: "fixture-basic", version: "1.0.0" });

server.tool(
  {
    name: "add",
    description: "Add two numbers",
    inputSchema: z.object({ a: z.number(), b: z.number() }),
  },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }],
  })
);

export default server;
