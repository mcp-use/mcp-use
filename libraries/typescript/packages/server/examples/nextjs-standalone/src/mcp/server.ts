import { MCPServer } from "mcp-use";
import { z } from "zod";

import { getProjectStatus } from "@/lib/project-service";

const server = new MCPServer({
  name: "nextjs-standalone-example",
  version: "1.0.0",
  title: "mcp-use beside a Next.js application",
});

export const projectStatus = server.tool(
  {
    name: "project-status",
    description:
      "Call a server-side service imported from the Next.js application.",
    inputSchema: z.object({}),
    outputSchema: z.object({ title: z.string(), detail: z.string() }),
    view: {
      name: "project-status",
      description: "Render a component imported from the Next.js application.",
      prefersBorder: true,
    },
  },
  async () => {
    const status = await getProjectStatus("MCP tool");
    return {
      content: [{ type: "text", text: status.detail }],
      structuredContent: status,
    };
  }
);

// The CLI owns the listener in standalone mode; the module only exports its server.
export default server;
