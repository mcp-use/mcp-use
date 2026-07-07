/**
 * Fruit Store — reference MCP Apps views server.
 *
 * Follows the CLI entry contract: default-export the MCPServer instance;
 * `mcp-use dev` / `build` / `start` own the socket and view priming.
 */
import { MCPServer, view } from "@mcp-use/server";
import { z } from "zod";

const BASE_PATH = "/mcp";

const FRUITS = [
  {
    id: "apple",
    name: "Apple",
    imageUrl: "https://images.example.com/fruits/apple.jpg",
  },
  {
    id: "banana",
    name: "Banana",
    imageUrl: "https://images.example.com/fruits/banana.jpg",
  },
  {
    id: "cherry",
    name: "Cherry",
    imageUrl: "https://images.example.com/fruits/cherry.jpg",
  },
  {
    id: "dragonfruit",
    name: "Dragonfruit",
    imageUrl: "https://images.example.com/fruits/dragonfruit.jpg",
  },
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
  banana: {
    name: "Banana",
    producer: "Tropical Harvest Ltd.",
    nutrition: { calories: 89, fiber: "2.6g" },
  },
  cherry: {
    name: "Cherry",
    producer: "Pacific Northwest Growers",
    nutrition: { calories: 50, fiber: "1.6g" },
  },
  dragonfruit: {
    name: "Dragonfruit",
    producer: "Sunbelt Exotics",
    nutrition: { calories: 60, fiber: "3.0g" },
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
  description: "Search fruits and browse details with an MCP Apps view.",
  basePath: BASE_PATH,
});

const resultsSchema = z.object({
  query: z.string(),
  items: z.array(
    z.object({ id: z.string(), name: z.string(), imageUrl: z.string() })
  ),
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
    schema: z.object({ query: z.string().optional() }),
    outputSchema: resultsSchema,
    view: { name: "product-search-result" },
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

    return view({
      props: { query, items },
      content: `Found ${items.length} fruits`,
    });
  }
);

export const getFruitDetails = server.tool(
  {
    name: "get-fruit-details",
    title: "Get fruit details",
    description: "Look up producer and nutrition information for a fruit.",
    schema: z.object({ fruit: z.string() }),
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
