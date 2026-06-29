/** @jsxImportSource mcp-use/jsx */
import { MCPServer, object, text, view } from "mcp-use/server";
import { z } from "zod";
import FruitSummaryCard from "./components/FruitSummaryCard";

const server = new MCPServer({
  name: "{{PROJECT_NAME}}",
  title: "{{PROJECT_NAME}}", // display name
  version: "1.0.0",
  description: "MCP server with direct inline JSX and advanced file widgets",
  instructions:
    "Use show-fruit-summary for a quick visual fruit card. Use search-fruits when the user wants to browse or compare fruit options in the carousel.",
  baseUrl: process.env.MCP_URL || "http://localhost:3000", // Full base URL (e.g., https://myserver.com)
  favicon: "favicon.ico",
  websiteUrl: "https://mcp-use.com", // Can be customized later
  icons: [
    {
      src: "icon.svg",
      mimeType: "image/svg+xml",
      sizes: ["512x512"],
    },
  ],
});

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
  fruit: z.string().describe("Fruit name"),
  color: z.string().describe("Tailwind background color class"),
});

function findFruit(name: string) {
  return (
    fruits.find((item) => item.fruit.toLowerCase() === name.toLowerCase()) ?? {
      fruit: name,
      color: "bg-default/10",
    }
  );
}

function fruitFacts(fruit: string): string[] {
  return [
    `${fruit} is ready to use in a typed MCP tool response.`,
    "This card is returned directly from the tool handler as inline JSX.",
  ];
}

server.tool(
  {
    name: "show-fruit-summary",
    title: "Show fruit summary",
    description: "Show a quick visual fruit summary with direct inline JSX",
    schema: z.object({
      fruit: z.string().describe("Fruit name to summarize"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    outputSchema: z.object({
      fruit: z.string(),
      color: z.string(),
      facts: z.array(z.string()),
    }),
  },
  async ({ fruit }) => {
    const selected = findFruit(fruit);
    const facts = fruitFacts(selected.fruit);

    return (
      <FruitSummaryCard
        fruit={selected.fruit}
        color={selected.color}
        facts={facts}
        _output={text(`${selected.fruit}: ${facts.join(" ")}`)}
        _invoking="Preparing fruit summary..."
        _invoked="Fruit summary ready"
        _prefersBorder={false}
      />
    );
  }
);

server.tool(
  {
    name: "search-fruits",
    title: "Search fruits",
    description:
      "Search fruits and display the results in the advanced file-based carousel widget",
    schema: z.object({
      query: z.string().optional().describe("Search query to filter fruits"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    outputSchema: z.object({
      query: z.string(),
      results: z.array(fruitRowSchema),
    }),
    widget: {
      name: "product-search-result",
      invoking: "Searching fruits...",
      invoked: "Fruit results loaded",
    },
  },
  async ({ query }) => {
    const normalizedQuery = query?.toLowerCase();
    const results = fruits.filter(
      (item) => !normalizedQuery || item.fruit.includes(normalizedQuery)
    );

    return view({
      props: { query: query ?? "", results },
      output: text(
        `Found ${results.length} fruits matching "${query ?? "all"}"`
      ),
    });
  }
);

server.tool(
  {
    name: "get-fruit-details",
    title: "Get fruit details",
    description: "Get detailed information about a specific fruit",
    schema: z.object({
      fruit: z.string().describe("The fruit name"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    outputSchema: z.object({
      fruit: z.string(),
      color: z.string(),
      facts: z.array(z.string()),
    }),
  },
  async ({ fruit }) => {
    const selected = findFruit(fruit);
    return object({
      fruit: selected.fruit,
      color: selected.color,
      facts: fruitFacts(selected.fruit),
    });
  }
);

await server.listen();
console.log("Server running");
