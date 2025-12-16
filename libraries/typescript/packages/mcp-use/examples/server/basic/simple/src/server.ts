import { MCPServer, text, object, markdown } from "mcp-use/server";
import z from "zod";

const server = new MCPServer({
  name: "simple-example-server",
  version: "1.0.0",
  description: "A simple MCP server example",
});

server.tool(
  {
    name: "hello-world",
    description: "A simple tool that returns hello world",
  },
  async () => text("Hello World!")
);

server.resource(
  {
    name: "greeting",
    uri: "app://greeting",
    title: "Greeting Message",
  },
  async () => markdown("# Hello from mcp-use!")
);

server.prompt(
  {
    name: "greeting",
    description: "A simple prompt that returns a greeting",
    schema: z.object({
      name: z.string(),
    }),
  },
  async ({ name }) => text(`Hello, ${name}!`)
);

// Start the server (MCP endpoints auto-mounted at /mcp)
await server.listen();
