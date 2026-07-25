import { type } from "arktype";
import { MCPServer } from "mcp-use";

const server = new MCPServer({
  name: "arktype-schema-example",
  version: "1.0.0",
  description: "Tool input validation with ArkType.",
});

server.tool(
  {
    name: "greet",
    inputSchema: type({
      name: type("string").describe("Name to greet"),
    }),
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello from ArkType, ${name}!` }],
  })
);

export default server;
