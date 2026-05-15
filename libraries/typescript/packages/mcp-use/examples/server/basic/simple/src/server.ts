import { MCPServer, text, object, markdown } from "mcp-use/server";
import z from "zod";

// Every mount path on this server is customized via the `routes` config:
// MCP endpoints live under /api/*, the inspector at /debug, widgets at /ui/*,
// and OAuth (if enabled) at /auth. Defaults preserve the original layout.
const server = new MCPServer({
  name: "simple-example-server",
  version: "1.0.0",
  description: "A simple MCP server example",
  routes: {
    mcpBasePath: "/api/mcp",
    sseBasePath: "/api/sse",
    widgetsBasePath: "/ui/widgets",
    publicBasePath: "/ui/static",
    inspectorBasePath: "/debug",
    oauthBasePath: "/auth",
  },
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

await server.listen();
