import { MCPServer } from "mcp-use/server";

const server = new MCPServer({
  name: "{{PROJECT_NAME}}",
  title: "{{PROJECT_NAME}}",
  version: "1.0.0",
  description: "Blank mcp-use server",
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
// TOOLS — actions the AI can call
// Docs: https://mcp-use.com/docs/typescript/server/tools
//
// server.tool(
//   { name: "my-tool", description: "...", schema: z.object({ input: z.string() }) },
//   async ({ input }) => text(`Result: ${input}`)
// );
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// RESOURCES — data the AI can read
// Docs: https://mcp-use.com/docs/typescript/server/resources
//
// server.resource(
//   { name: "config", uri: "config://settings", description: "..." },
//   async () => object({ theme: "dark", language: "en" })
// );
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// PROMPTS — reusable message templates
// Docs: https://mcp-use.com/docs/typescript/server/prompts
//
// server.prompt(
//   { name: "review-code", schema: z.object({ code: z.string() }) },
//   async ({ code }) => text(`Please review this code:\n\n${code}`)
// );
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
server.listen(PORT);
