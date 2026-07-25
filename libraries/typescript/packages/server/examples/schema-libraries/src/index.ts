import { type } from "arktype";
import { fromJsonSchema, MCPServer } from "mcp-use";
import Type from "typebox";
import { z } from "zod";

const server = new MCPServer({
  name: "schema-libraries-example",
  version: "1.0.0",
  description: "The same tool pattern with Zod, ArkType, and TypeBox.",
});

server.tool(
  {
    name: "greet-with-zod",
    inputSchema: z.object({
      name: z.string().describe("Name to greet"),
    }),
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello from Zod, ${name}!` }],
  })
);

server.tool(
  {
    name: "greet-with-arktype",
    inputSchema: type({
      name: type("string").describe("Name to greet"),
    }),
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello from ArkType, ${name}!` }],
  })
);

const typeboxInput = Type.Object({
  name: Type.String({ description: "Name to greet" }),
});

server.tool(
  {
    name: "greet-with-typebox",
    inputSchema: fromJsonSchema<Type.Static<typeof typeboxInput>>(typeboxInput),
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello from TypeBox, ${name}!` }],
  })
);

export default server;
