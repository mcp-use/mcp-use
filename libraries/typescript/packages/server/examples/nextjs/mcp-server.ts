import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "nextjs-example",
  version: "1.0.0",
  title: "mcp-use in a Next.js route",
  basePath: "/api/mcp",
});

// This tool is registered directly and returns a normal text result.
export const greet = server.tool(
  {
    name: "greet",
    description: "Greet a person.",
    inputSchema: z.object({ name: z.string() }),
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello, ${name}!` }],
  })
);

// The `view.name` matches views/next-status-card/view.tsx. `mcp-use build`
// discovers that file and binds its generated MCP Apps resource to this tool.
export const showStatusCard = server.tool(
  {
    name: "show-status-card",
    description:
      "Render the shared Next.js status-card component in an MCP App view.",
    inputSchema: z.object({}),
    outputSchema: z.object({ title: z.string(), detail: z.string() }),
    view: {
      name: "next-status-card",
      description: "A status card shared with the Next.js landing page.",
      prefersBorder: true,
    },
  },
  async () => ({
    content: [{ type: "text", text: "Opened the Next.js status card." }],
    structuredContent: {
      title: "MCP view ready",
      detail: "This card is also rendered on the Next.js landing page.",
    },
  })
);

export default server;
