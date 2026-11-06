import { MCPServer } from "mcp-use";
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
    inputSchema: z.object({ query: z.string().optional() }),
    outputSchema: resultsSchema,
    view: {
      name: "product-search-result",
      description: "Product search results grid",
      csp: { resourceDomains: ["https://images.example.com"] },
      prefersBorder: true,
    },
  },
  async ({ query = "" }) => ({
    structuredContent: {
      query,
      items: [{ id: "1", name: "widget" }],
    },
    content: [{ type: "text", text: `Found 1 product for "${query}"` }],
  })
);

export default server;
