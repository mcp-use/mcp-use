import { z } from "zod";

import { MCPServer } from "../../src/index.js";

const server = new MCPServer({ name: "fixture", version: "0.0.0" });

export const notATool = "ignored";

export const searchFruits = server.tool(
  {
    name: "search-fruits",
    inputSchema: z.object({ query: z.string().optional() }),
    outputSchema: z.object({
      query: z.string(),
      items: z.array(z.object({ id: z.string() })),
    }),
  },
  async () => ({
    content: [{ type: "text", text: "ok" }],
    structuredContent: { query: "", items: [] },
  })
);

// Schema-less tool: no outputSchema, so its inferred output is `never` and
// any CallToolResult (content-only included) is a valid return.
export const ping = server.tool(
  {
    name: "ping",
    inputSchema: z.object({ id: z.string() }),
  },
  async ({ id }) => ({
    content: [{ type: "text", text: id }],
  })
);

export { getDetails } from "./react-register-tools-details.js";
