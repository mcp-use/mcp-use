import { MCPServer, object, text, widget } from "mcp-use/server";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT VARIABLES
// Create a .env file in this directory and load it:
//
//   import { config } from "dotenv";
//   config();
//
// Then access variables via process.env:
//   const apiKey = process.env.MY_API_KEY;
//
// Common variables:
//   PORT=3000
//   MY_API_KEY=sk-...
//   DATABASE_URL=postgresql://...
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// OAUTH AUTHENTICATION (optional)
// To protect your server with Auth0, add the oauth option to MCPServer:
//
//   import { oauthAuth0Provider } from "mcp-use/server";
//
//   const server = new MCPServer({
//     name: "...",
//     oauth: oauthAuth0Provider({
//       domain: process.env.AUTH0_DOMAIN!,       // "your-tenant.auth0.com"
//       audience: process.env.AUTH0_AUDIENCE!,   // "https://your-api.example.com"
//     }),
//   });
//
// Then access auth context in tools:
//   server.tool({ name: "..." }, async (params, ctx) => {
//     const userId = ctx.auth.userId;
//     return text(`Hello, ${userId}`);
//   });
//
// Other providers: oauthWorkOSProvider, oauthSupabaseProvider, oauthKeycloakProvider
// Docs: https://mcp-use.com/docs/typescript/server/authentication
// ─────────────────────────────────────────────────────────────────────────────

const server = new MCPServer({
  name: "{{PROJECT_NAME}}",
  title: "{{PROJECT_NAME}}",
  version: "1.0.0",
  description: "MCP server with UI widgets",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
  favicon: "favicon.ico",
  websiteUrl: "https://mcp-use.com",
  icons: [
    {
      src: "icon.svg",
      mimeType: "image/svg+xml",
      sizes: ["512x512"],
    },
  ],
});

// Fruits data — color values are Tailwind bg-[] classes used by the carousel UI
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

// API endpoint for fruits data (used by the widget)
server.get("/api/fruits", (c) => {
  return c.json(fruits);
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL THAT RETURNS A WIDGET
// The `widget` config tells mcp-use which widget component to render.
// The `widget()` helper in the handler passes props to that component.
// Docs: https://mcp-use.com/docs/typescript/server/ui-widgets
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  {
    name: "search-fruits",
    description: "Search for fruits and display the results in a visual widget",
    schema: z.object({
      query: z.string().optional().describe("Search query to filter fruits"),
    }),
    widget: {
      name: "product-search-result",
      invoking: "Searching fruits...",
      invoked: "Fruits loaded",
    },
  },
  async ({ query }) => {
    const results = fruits.filter(
      (f) => !query || f.fruit.toLowerCase().includes(query.toLowerCase())
    );

    return widget({
      props: { query: query ?? "", results },
      output: text(
        `Found ${results.length} fruits matching "${query ?? "all"}"`
      ),
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PLAIN TOOL WITH outputSchema
// Defines the shape of the structured output — enables type inference
// in useCallTool("get-fruit-details") inside your widget components.
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  {
    name: "get-fruit-details",
    description: "Get detailed information about a specific fruit",
    schema: z.object({
      fruit: z.string().describe("The fruit name"),
    }),
    outputSchema: z.object({
      fruit: z.string(),
      color: z.string(),
      facts: z.array(z.string()),
    }),
  },
  async ({ fruit }) => {
    const found = fruits.find((f) => f.fruit === fruit);
    return object({
      fruit: found?.fruit ?? fruit,
      color: found?.color ?? "unknown",
      facts: [
        `${fruit} is a delicious fruit`,
        `Color: ${found?.color ?? "unknown"}`,
      ],
    });
  }
);

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
server.listen(PORT);
