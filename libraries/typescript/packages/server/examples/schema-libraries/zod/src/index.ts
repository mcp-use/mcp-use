import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "zod-schema-example",
  version: "1.0.0",
  description: "Tool input validation with Zod.",
});

server.tool(
  {
    name: "greet",
    inputSchema: z.object({
      name: z.string().describe("Name to greet"),
    }),
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello from Zod, ${name}!` }],
  })
);

export default server;
