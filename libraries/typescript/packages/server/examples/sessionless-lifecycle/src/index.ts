import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "sessionless-lifecycle-example",
  version: "1.0.0",
  title: "Stateless MCP lifecycle",
  description: "Shows request-scoped context on the stateless V2 wire.",
});

server.tool(
  {
    name: "request-info",
    description: "Report information scoped to this one MCP request.",
    outputSchema: z.object({
      aborted: z.boolean(),
      supportsViews: z.boolean(),
    }),
  },
  async (_input, ctx) => {
    // A fresh SDK server is created for every HTTP request. Do not put client
    // identity or workflow state in module variables; return an explicit handle
    // and let the caller provide it again on a later request if needed.
    const data = {
      aborted: ctx.signal.aborted,
      supportsViews: ctx.client.supportsViews(),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
);

export default server;
