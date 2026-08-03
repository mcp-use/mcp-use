import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "public-landing-example",
  version: "1.0.0",
  title: "Public landing page example",
  description: "A small MCP server with a browser-friendly endpoint page.",
  websiteUrl: "https://github.com/mcp-use/mcp-use",
  // This matters only when OAuth is configured: HTML navigation stays public,
  // while MCP-shaped requests at the same path still require a bearer token.
  publicLandingPage: true,
});

server.tool(
  {
    name: "greet",
    description: "Return a friendly greeting.",
    inputSchema: z.object({ name: z.string().min(1) }),
    outputSchema: z.object({ greeting: z.string() }),
  },
  async ({ name }) => {
    const data = { greeting: `Hello, ${name}!` };
    return {
      content: [{ type: "text", text: data.greeting }],
      structuredContent: data,
    };
  }
);

export default server;
