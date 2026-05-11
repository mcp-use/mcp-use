import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";

// Create MCP server instance
const server = new MCPServer({
  name: "{{PROJECT_NAME}}",
  title: "{{PROJECT_NAME}}", // display name
  version: "1.0.0",
  description: "Blank mcp-use server",
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

/**
 * Define UI Widgets
 * All React components in the `resources/` folder
 * are automatically registered as MCP tools and resources.
 *
 * Just export widgetMetadata with description and Zod schema,
 * and mcp-use handles the rest!
 *
 * Docs: https://mcp-use.com/docs/typescript/server/mcp-apps
 */

/**
 * Define MCP tools
 * Docs: https://mcp-use.com/docs/typescript/server/tools
 *
 * Response helpers (`text`, `object`, `image`, `markdown`, `html`, `error`,
 * `widget`, ...) are exported from `mcp-use/server`.
 */
server.tool(
  {
    name: "echo",
    description: "Echo a message back to the caller",
    schema: z.object({
      message: z.string().describe("The message to echo back"),
    }),
  },
  async ({ message }) => {
    return text(message);
  }
);

/*
 * Define MCP resources
 * Docs: https://mcp-use.com/docs/typescript/server/resources

server.resource({
  name: "config",
  uri: "config://settings",
  description: "Server configuration",
}, async () => object({
  theme: "dark",
  language: "en",
}));
*/

/*
 * Define MCP prompts
 * Docs: https://mcp-use.com/docs/typescript/server/prompts

server.prompt(
  {
    name: "review-code",
    description: "Review code for best practices and potential issues",
    schema: z.object({
      code: z.string().describe("The code to review"),
    }),
  },
  async ({ code }) => {
    return text(`Please review this code:\n\n${code}`);
  }
); */

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
console.log(`Server running on port ${PORT}`);
// Start the server
server.listen(PORT);
