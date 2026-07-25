import { fromJsonSchema, MCPServer } from "mcp-use";
import Type from "typebox";

const server = new MCPServer({
  name: "typebox-schema-example",
  version: "1.0.0",
  description: "Tool input validation with TypeBox.",
});

const greetInput = Type.Object({
  name: Type.String({ description: "Name to greet" }),
});

server.tool(
  {
    name: "greet",
    inputSchema: fromJsonSchema<Type.Static<typeof greetInput>>(greetInput),
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello from TypeBox, ${name}!` }],
  })
);

export default server;
