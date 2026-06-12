import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "basic-tool-server",
  version: "1.0.0",
  description: "Golden solution for the basic tool server eval task",
});

server.tool(
  {
    name: "add",
    description: "Add two numbers and return the sum",
    schema: z.object({
      a: z.number().describe("First addend"),
      b: z.number().describe("Second addend"),
    }),
  },
  async ({ a, b }) => text(String(a + b))
);

// listen() resolves the port from PORT env (default 3000)
await server.listen();
