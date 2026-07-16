/**
 * Fruit Store — reference MCP Apps views server.
 *
 * Follows the CLI entry contract: default-export the MCPServer instance;
 * `mcp-use dev` / `build` / `start` own the socket and view priming.
 */
import { completable, inputRequired, inputResponse, MCPServer } from "mcp-use";
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
  {
    name: string;
    producer: string;
    nutrition: { calories: number; fiber: string };
  }
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
  // Load the inspector bundle from a local build instead of the public CDN:
  //   npx serve --cors -p 4173 ../../../inspector/dist/cdn
  //   INSPECTOR_ASSETS_URL=http://localhost:4173/inspector.js mcp-use dev
  ...(process.env.INSPECTOR_ASSETS_URL
    ? { inspector: { assetsUrl: process.env.INSPECTOR_ASSETS_URL } }
    : {}),
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

export const reportClientCapabilities = server.tool(
  {
    name: "report-client-capabilities",
    title: "Report client capabilities",
    description:
      "Report client capabilities advertised on this connection (MCP Apps / UI extension).",
    inputSchema: z.object({}),
    outputSchema: z.object({ supportsApps: z.boolean() }),
  },
  async (_input, ctx) => {
    const supportsApps = ctx.client.supportsViews();
    return {
      content: [
        {
          type: "text",
          text: supportsApps
            ? "Client advertises MCP Apps support"
            : "Client does not advertise MCP Apps support",
        },
      ],
      structuredContent: { supportsApps },
    };
  }
);

export const collectUserInfo = server.tool(
  {
    name: "collect-user-info",
    title: "Collect user information",
    description:
      "Request typed user input through modern multi-round-trip elicitation.",
    inputSchema: z.object({}),
    outputSchema: z.object({ name: z.string(), age: z.number() }),
  },
  async (_input, ctx) => {
    const form = await ctx.input.form({
      key: "profile",
      message: "Provide a profile for the client example",
      schema: z.object({
        name: z.string().default("Anonymous"),
        age: z.number().default(0),
      }),
    });
    if (form.status === "required") return form.result;
    if (form.status === "accepted") {
      return {
        content: [
          {
            type: "text",
            text: `Received ${form.value.name}, age ${form.value.age}`,
          },
        ],
        structuredContent: form.value,
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Input ${form.status}` }],
    };
  }
);

export const sampleText = server.tool(
  {
    name: "sample-text",
    title: "Sample text",
    description:
      "Request an LLM sample through modern multi-round-trip client input.",
    inputSchema: z.object({
      prompt: z.string().describe("Prompt sent to the client sampling handler"),
    }),
  },
  async ({ prompt }, ctx) => {
    const response = inputResponse(ctx.inputResponses, "sample");
    if (response.kind === "missing") {
      return inputRequired({
        inputRequests: {
          sample: inputRequired.createMessage({
            messages: [
              { role: "user", content: { type: "text", text: prompt } },
            ],
            maxTokens: 100,
          }),
        },
      });
    }
    if (response.kind === "sampling") {
      const blocks = Array.isArray(response.result.content)
        ? response.result.content
        : [response.result.content];
      const text = blocks
        .map((block) =>
          block.type === "text" ? block.text : JSON.stringify(block)
        )
        .join("\n");
      return { content: [{ type: "text", text }] };
    }
    return {
      isError: true,
      content: [{ type: "text", text: "Expected a sampling response" }],
    };
  }
);

server.resource(
  {
    name: "client-showcase-info",
    uri: "demo://client-showcase",
    title: "Client showcase information",
    description: "Static data used by the client resource example.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          server: "mcp-use-v2",
          era: "modern",
          transport: "stateless",
        }),
      },
    ],
  })
);

server.resourceTemplate(
  {
    name: "fruit-by-id",
    uriTemplate: "fruit://{id}",
    title: "Fruit by ID",
    description: "Read one fruit record by ID.",
    mimeType: "application/json",
  },
  async (uri, params) => {
    const id = String(params.id);
    const details = FRUIT_DETAILS[id];
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(details ?? { id, found: false }),
        },
      ],
    };
  }
);

server.prompt(
  {
    name: "review-fruit",
    title: "Review fruit",
    description: "Generate a reusable fruit review prompt.",
    schema: z.object({
      fruit: completable(z.string().describe("Fruit to review"), [
        "apple",
        "banana",
        "mango",
      ]),
    }),
  },
  async ({ fruit }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Review ${fruit} for taste, nutrition, and typical uses.`,
        },
      },
    ],
  })
);

export default server;
