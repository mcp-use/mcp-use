import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "middleware-example",
  version: "1.0.0",
  description: "Shows typed, protocol-level MCP middleware.",
});

server.use("mcp:tools/call", async (ctx, next) => {
  // State is shared only by middleware participating in this one request.
  ctx.state.set("called-through-middleware", true);
  return next();
});

server.use("mcp:tools/list", async (ctx, next) => {
  // Operation middleware has both parsed MCP params and the original request.
  if (ctx.request?.header("x-example-access") !== "allow") {
    throw new Error("Tool discovery requires x-example-access: allow.");
  }
  return next();
});

server.tool(
  { name: "echo", inputSchema: z.object({ message: z.string() }) },
  async ({ message }) => ({
    content: [
      {
        type: "text",
        text: `${message} (passed through mcp:tools/call middleware)`,
      },
    ],
  })
);

export default server;
