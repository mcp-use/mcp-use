import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "tanstack-start-example",
  version: "1.0.0",
  title: "mcp-use in a TanStack Start route",
  basePath: "/api/mcp",
  cors: {
    origin: "*",
    methods: ["GET", "HEAD", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Accept",
      "Mcp-Protocol-Version",
      "Mcp-Method",
      "Mcp-Name",
      "Mcp-Session-Id",
      "Last-Event-ID",
    ],
  },
});

export const greet = server.tool(
  {
    name: "greet",
    description: "Greet a person.",
    inputSchema: z.object({ name: z.string() }),
  },
  async ({ name }) => ({ content: [{ type: "text", text: `Hello, ${name}!` }] })
);

export const showStatusCard = server.tool(
  {
    name: "show-status-card",
    description: "Render a card shared with the TanStack Start page.",
    inputSchema: z.object({}),
    outputSchema: z.object({ title: z.string(), detail: z.string() }),
    view: { name: "tanstack-start-status-card", prefersBorder: true },
  },
  async () => ({
    content: [{ type: "text", text: "Opened the TanStack Start status card." }],
    structuredContent: {
      title: "MCP view ready",
      detail: "This card is also rendered on the TanStack Start page.",
    },
  })
);

export default server;
