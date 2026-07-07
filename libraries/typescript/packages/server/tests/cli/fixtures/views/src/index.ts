import { MCPServer, view } from "@mcp-use/server";
import { z } from "zod";

const server = new MCPServer({ name: "fixture-views", version: "1.0.0" });

const resultsSchema = z.object({
  query: z.string(),
  items: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const searchProducts = server.tool(
  {
    name: "search-products",
    description: "Search products",
    schema: z.object({ query: z.string().optional() }),
    outputSchema: resultsSchema,
    view: { name: "product-search-result" },
  },
  async ({ query = "" }) =>
    view({
      props: {
        query,
        items: [{ id: "1", name: "widget" }],
      },
      content: `Found 1 product for "${query}"`,
    })
);

export default server;
