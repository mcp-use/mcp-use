import { MCPServer, object, text, completable } from "mcp-use/server";
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
  description: "MCP server with tools, resources, and prompts",
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

// ─────────────────────────────────────────────────────────────────────────────
// TOOL — actions the AI can call
// Docs: https://mcp-use.com/docs/typescript/server/tools
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  {
    name: "fetch-weather",
    description: "Fetch the weather for a city",
    schema: z.object({
      city: z.string().describe("The city to fetch the weather for"),
    }),
  },
  async ({ city }) => {
    return text(`The weather in ${city} is sunny`);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// RESOURCE — data the AI can read
// Docs: https://mcp-use.com/docs/typescript/server/resources
// ─────────────────────────────────────────────────────────────────────────────
server.resource(
  {
    name: "config",
    uri: "config://settings",
    description: "Server configuration",
  },
  async () =>
    object({
      theme: "dark",
      language: "en",
    })
);

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT — reusable message template
// Docs: https://mcp-use.com/docs/typescript/server/prompts
// ─────────────────────────────────────────────────────────────────────────────
server.prompt(
  {
    name: "review-code",
    description: "Review code for best practices and potential issues",
    schema: z.object({
      language: completable(z.string(), [
        "python",
        "javascript",
        "typescript",
        "java",
        "cpp",
        "go",
        "rust",
      ]).describe("The programming language"),
      code: z.string().describe("The code to review"),
    }),
  },
  async ({ language, code }) => {
    return text(`Reviewing ${language} code:\n\n${code}`);
  }
);

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
server.listen(PORT);
