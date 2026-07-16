import { MCPServer } from "mcp-use";
import { z } from "zod";

const fruits = ["apple", "banana", "mango", "orange", "strawberry"];

const outputSchema = z.object({
  query: z.string(),
  items: z.array(z.object({ id: z.string(), name: z.string() })),
});

const server = new MCPServer({
  name: "{{PROJECT_NAME}}",
  title: "{{PROJECT_NAME}}",
  version: "1.0.0",
  description: "An MCP Apps server built with mcp-use",
});

server.tool(
  {
    name: "search-fruits",
    description: "Search the fruit catalog",
    inputSchema: z.object({ query: z.string().optional() }),
    outputSchema,
    view: {
      name: "product-search-result",
      description: "Fruit search results",
      prefersBorder: true,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ query = "" }) => {
    const items = fruits
      .filter((fruit) => fruit.includes(query.toLowerCase()))
      .map((fruit) => ({ id: fruit, name: fruit }));
    const data = { query, items };
    return {
      content: [{ type: "text", text: `Found ${items.length} fruits.` }],
      structuredContent: data,
    };
  }
);

export default server;
