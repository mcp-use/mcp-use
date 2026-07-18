import { MCPServer } from "mcp-use";
import { z } from "zod";

const fruits = [
  { fruit: "mango", color: "bg-[#FBF1E1] dark:bg-[#FBF1E1]/10" },
  { fruit: "pineapple", color: "bg-[#f8f0d9] dark:bg-[#f8f0d9]/10" },
  { fruit: "cherries", color: "bg-[#E2EDDC] dark:bg-[#E2EDDC]/10" },
  { fruit: "coconut", color: "bg-[#fbedd3] dark:bg-[#fbedd3]/10" },
  { fruit: "apricot", color: "bg-[#fee6ca] dark:bg-[#fee6ca]/10" },
  { fruit: "blueberry", color: "bg-[#e0e6e6] dark:bg-[#e0e6e6]/10" },
  { fruit: "grapes", color: "bg-[#f4ebe2] dark:bg-[#f4ebe2]/10" },
  { fruit: "watermelon", color: "bg-[#e6eddb] dark:bg-[#e6eddb]/10" },
  { fruit: "orange", color: "bg-[#fdebdf] dark:bg-[#fdebdf]/10" },
  { fruit: "avocado", color: "bg-[#ecefda] dark:bg-[#ecefda]/10" },
  { fruit: "apple", color: "bg-[#F9E7E4] dark:bg-[#F9E7E4]/10" },
  { fruit: "pear", color: "bg-[#f1f1cf] dark:bg-[#f1f1cf]/10" },
  { fruit: "plum", color: "bg-[#ece5ec] dark:bg-[#ece5ec]/10" },
  { fruit: "banana", color: "bg-[#fdf0dd] dark:bg-[#fdf0dd]/10" },
  { fruit: "strawberry", color: "bg-[#f7e6df] dark:bg-[#f7e6df]/10" },
  { fruit: "lemon", color: "bg-[#feeecd] dark:bg-[#feeecd]/10" },
];

const fruitRowSchema = z.object({
  fruit: z.string(),
  color: z.string(),
});

const searchOutputSchema = z.object({
  query: z.string(),
  results: z.array(fruitRowSchema),
});

const detailsOutputSchema = z.object({
  fruit: z.string(),
  color: z.string(),
  facts: z.array(z.string()),
});

function renderAsMarkdownTable(
  results: Array<{ fruit: string; color: string }>
): string {
  const header = "| Fruit | Color |\n| --- | --- |";
  const rows = results.map((r) => `| ${r.fruit} | ${r.color} |`).join("\n");
  return `${header}\n${rows}`;
}

const server = new MCPServer({
  name: "{{PROJECT_NAME}}",
  title: "{{PROJECT_NAME}}",
  version: "1.0.0",
  description: "MCP Apps server with a fruit shop view",
  instructions:
    "Use search-fruits to find fruit matches before calling get-fruit-details. Prefer the view result when the user wants to browse or compare options visually.",
  websiteUrl: "https://mcp-use.com",
  icons: [
    {
      src: "icon.svg",
      mimeType: "image/svg+xml",
      sizes: ["512x512"],
    },
  ],
});

export const searchFruits = server.tool(
  {
    name: "search-fruits",
    title: "Search fruits",
    description: "Search for fruits and display the results in a view",
    inputSchema: z.object({
      query: z.string().optional().describe("Search query to filter fruits"),
    }),
    outputSchema: searchOutputSchema,
    view: {
      name: "product-search-result",
      description: "Product search results with carousel and details",
      prefersBorder: true,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ query = "" }, ctx) => {
    const results = fruits.filter(
      (f) => query === "" || f.fruit.toLowerCase().includes(query.toLowerCase())
    );

    // Emulate a delay to show the loading state in the view
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const data = { query, results };

    if (!ctx.client.supportsViews()) {
      return {
        content: [{ type: "text", text: renderAsMarkdownTable(results) }],
        structuredContent: data,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Found ${results.length} fruits matching "${query || "all"}"`,
        },
      ],
      structuredContent: data,
    };
  }
);

export const getFruitDetails = server.tool(
  {
    name: "get-fruit-details",
    title: "Get fruit details",
    description: "Get detailed information about a specific fruit",
    inputSchema: z.object({
      fruit: z.string().describe("The fruit name"),
    }),
    outputSchema: detailsOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ fruit }) => {
    const found = fruits.find(
      (f) => f.fruit.toLowerCase() === fruit.toLowerCase()
    );
    const details = {
      fruit: found?.fruit ?? fruit,
      color: found?.color ?? "unknown",
      facts: [
        `${fruit} is a delicious fruit`,
        `Color: ${found?.color ?? "unknown"}`,
      ],
    };
    return {
      content: [{ type: "text", text: JSON.stringify(details) }],
      structuredContent: details,
    };
  }
);

export default server;
