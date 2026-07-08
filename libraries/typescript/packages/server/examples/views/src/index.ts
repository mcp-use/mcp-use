/**
 * Fruit Store — reference MCP Apps views server.
 *
 * Follows the CLI entry contract: default-export the MCPServer instance;
 * `mcp-use dev` / `build` / `start` own the socket and view priming.
 */
import { MCPServer } from "@mcp-use/server";
import { z } from "zod";

const BASE_PATH = "/mcp";

const FRUITS = [
  { id: "apple", name: "Apple" },
  { id: "apricot", name: "Apricot" },
  { id: "avocado", name: "Avocado" },
  { id: "banana", name: "Banana" },
  { id: "blueberry", name: "Blueberry" },
  { id: "cherries", name: "Cherries" },
  { id: "coconut", name: "Coconut" },
  { id: "grapes", name: "Grapes" },
  { id: "lemon", name: "Lemon" },
  { id: "mango", name: "Mango" },
  { id: "orange", name: "Orange" },
  { id: "pear", name: "Pear" },
  { id: "pineapple", name: "Pineapple" },
  { id: "plum", name: "Plum" },
  { id: "strawberry", name: "Strawberry" },
  { id: "watermelon", name: "Watermelon" },
] as const;

type FruitItem = (typeof FRUITS)[number];

const FRUIT_DETAILS: Record<
  string,
  { name: string; producer: string; nutrition: { calories: number; fiber: string } }
> = {
  apple: {
    name: "Apple",
    producer: "Orchard Hills Co-op",
    nutrition: { calories: 52, fiber: "2.4g" },
  },
  apricot: {
    name: "Apricot",
    producer: "Suncrest Orchards",
    nutrition: { calories: 48, fiber: "2.0g" },
  },
  avocado: {
    name: "Avocado",
    producer: "Green Valley Growers",
    nutrition: { calories: 160, fiber: "6.7g" },
  },
  banana: {
    name: "Banana",
    producer: "Tropical Harvest Ltd.",
    nutrition: { calories: 89, fiber: "2.6g" },
  },
  blueberry: {
    name: "Blueberry",
    producer: "Northern Berry Farms",
    nutrition: { calories: 57, fiber: "2.4g" },
  },
  cherries: {
    name: "Cherries",
    producer: "Pacific Northwest Growers",
    nutrition: { calories: 50, fiber: "1.6g" },
  },
  coconut: {
    name: "Coconut",
    producer: "Island Harvest Co.",
    nutrition: { calories: 354, fiber: "9.0g" },
  },
  grapes: {
    name: "Grapes",
    producer: "Vineyard Ridge Estates",
    nutrition: { calories: 69, fiber: "0.9g" },
  },
  lemon: {
    name: "Lemon",
    producer: "Citrus Coast Collective",
    nutrition: { calories: 29, fiber: "2.8g" },
  },
  mango: {
    name: "Mango",
    producer: "Tropical Harvest Ltd.",
    nutrition: { calories: 60, fiber: "1.6g" },
  },
  orange: {
    name: "Orange",
    producer: "Citrus Coast Collective",
    nutrition: { calories: 47, fiber: "2.4g" },
  },
  pear: {
    name: "Pear",
    producer: "Orchard Hills Co-op",
    nutrition: { calories: 57, fiber: "3.1g" },
  },
  pineapple: {
    name: "Pineapple",
    producer: "Island Harvest Co.",
    nutrition: { calories: 50, fiber: "1.4g" },
  },
  plum: {
    name: "Plum",
    producer: "Suncrest Orchards",
    nutrition: { calories: 46, fiber: "1.4g" },
  },
  strawberry: {
    name: "Strawberry",
    producer: "Northern Berry Farms",
    nutrition: { calories: 32, fiber: "2.0g" },
  },
  watermelon: {
    name: "Watermelon",
    producer: "Sunbelt Exotics",
    nutrition: { calories: 30, fiber: "0.4g" },
  },
};

function searchFruitItems(query: string): FruitItem[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return [...FRUITS];
  return FRUITS.filter(
    (fruit) =>
      fruit.name.toLowerCase().includes(normalized) ||
      fruit.id.includes(normalized)
  );
}

function renderAsMarkdownTable(items: FruitItem[]): string {
  const header = "| Name | ID |\n| --- | --- |";
  const rows = items.map((item) => `| ${item.name} | ${item.id} |`).join("\n");
  return `${header}\n${rows}`;
}

const server = new MCPServer({
  name: "fruit-store",
  version: "1.0.0",
  title: "Fruit Store",
  legacy: "stateless",
  logging: { level: "debug" },
  description: "Search fruits and browse details with an MCP Apps view.",
  basePath: BASE_PATH,
});

const resultsSchema = z.object({
  query: z.string(),
  items: z.array(z.object({ id: z.string(), name: z.string() })),
});

const detailsSchema = z.object({
  name: z.string(),
  producer: z.string(),
  nutrition: z.object({
    calories: z.number(),
    fiber: z.string(),
  }),
});

export const searchFruits = server.tool(
  {
    name: "search-fruits",
    title: "Search fruits",
    description: "Search the fruit catalog and render results in a view.",
    inputSchema: z.object({ query: z.string().optional() }),
    outputSchema: resultsSchema,
    view: {
      name: "product-search-result",
      description: "Product search results grid",
      prefersBorder: true,
    },
  },
  async ({ query = "" }, ctx) => {
    const items = searchFruitItems(query);

    if (!ctx.client.supportsViews()) {
      return {
        content: [
          {
            type: "text",
            text: renderAsMarkdownTable(items),
          },
        ],
        structuredContent: { query, items },
      };
    }

    return {
      content: [{ type: "text", text: `Found ${items.length} fruits` }],
      structuredContent: { query, items },
      _meta: {
        imageVariants: Object.fromEntries(
          items.map((item) => [
            item.id,
            { thumb: `${item.id}-thumb`, full: item.id },
          ])
        ),
      },
    };
  }
);

export const getFruitDetails = server.tool(
  {
    name: "get-fruit-details",
    title: "Get fruit details",
    description: "Look up producer and nutrition information for a fruit.",
    inputSchema: z.object({ fruit: z.string() }),
    outputSchema: detailsSchema,
  },
  async ({ fruit }) => {
    const normalized = fruit.trim().toLowerCase();
    const byId = FRUIT_DETAILS[normalized];
    const byName = Object.values(FRUIT_DETAILS).find(
      (entry) => entry.name.toLowerCase() === normalized
    );
    const details = byId ?? byName;

    if (details === undefined) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown fruit: ${fruit}` }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(details) }],
      structuredContent: details,
    };
  }
);

export default server;
