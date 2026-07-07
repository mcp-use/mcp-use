import { z } from "zod";

import { MCPServer } from "../../src/index.js";

const server = new MCPServer({ name: "fixture", version: "0.0.0" });

export const notATool = "ignored";

export const searchFruits = server.tool(
  {
    name: "search-fruits",
    schema: z.object({ query: z.string().optional() }),
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

export { getDetails } from "./react-register-tools-details.js";
