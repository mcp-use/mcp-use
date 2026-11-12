import type { D1Database, ExecutionContext } from "@cloudflare/workers-types";
import { MCPServer } from "mcp-use";
import { z } from "zod";

export interface Env {
  /** Optional D1 binding for an OAuth proxy store. */
  OAUTH_DB?: D1Database;
}

const server = new MCPServer({
  name: "cloudflare-workers-example",
  version: "1.0.0",
  title: "mcp-use on Cloudflare Workers",
  description: "Minimal MCP server running on the Workers edge runtime.",
  basePath: "/mcp",
});

server.tool(
  {
    name: "echo",
    title: "Echo a message",
    description: "Return the message from the Workers runtime",
    inputSchema: z.object({
      message: z.string().describe("The message to echo"),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ message }) => ({
    content: [
      {
        type: "text",
        text: `Cloudflare Worker: ${message}`,
      },
    ],
  })
);

export default {
  /**
   * Workers calls this for every request routed to the deployment.
   *
   * `server.fetch` is the framework's web-standard handler, so the Worker
   * needs no Node adapter. Bindings remain available through `env` for tools
   * or OAuth storage that need them.
   */
  fetch(
    request: Request,
    _env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    return server.fetch(request);
  },
};
