import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "sampling-example",
  version: "1.0.0",
  title: "Sampling boundary",
  description:
    "Documents the V2 sampling boundary without relying on sessions.",
});

server.tool(
  {
    name: "explain-sampling",
    description: "Explain whether server-initiated sampling is available.",
    inputSchema: z.object({ task: z.string().min(1) }),
    outputSchema: z.object({
      task: z.string(),
      supported: z.literal(false),
      guidance: z.string(),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ task }) => {
    // mcp-use deliberately does not expose the old server-to-client sampling
    // callback. It depended on a long-lived session, which V2 no longer has.
    const data = {
      task,
      supported: false as const,
      guidance:
        "Ask the host/model to perform this task, then call a tool with its result.",
    };
    return {
      content: [{ type: "text", text: data.guidance }],
      structuredContent: data,
    };
  }
);

export default server;
