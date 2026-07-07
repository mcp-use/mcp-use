import { z } from "zod";

import { MCPServer } from "../../src/index.js";

const server = new MCPServer({ name: "fixture", version: "0.0.0" });

export const getDetails = server.tool(
  {
    name: "get-details",
    schema: z.object({ id: z.string() }),
    outputSchema: z.object({ name: z.string() }),
  },
  async ({ id }) => ({
    content: [{ type: "text", text: id }],
    structuredContent: { name: id },
  })
);
