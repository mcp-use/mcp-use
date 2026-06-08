import { MCPServer, object, text, error, completable } from "mcp-use/server";
import { z } from "zod";

// Create MCP server instance
const server = new MCPServer({
  name: "{{PROJECT_NAME}}",
  title: "{{PROJECT_NAME}}", // display name
  version: "1.0.0",
  description: "My first MCP server with all features",
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
 * Docs: https://manufact.com/docs/typescript/server/mcp-apps
 */

/*
 * Define MCP tools
 * Docs: https://mcp-use.com/docs/typescript/server/tools
 */
server.tool(
  {
    name: "fetch-weather",
    title: "Fetch Weather",
    description:
      "Use this when the user asks for current weather, weather conditions, or a forecast for a specific city.",
    schema: z.object({
      city: z
        .string()
        .describe("City name to fetch weather for, such as 'San Francisco' or 'Tokyo'."),
    }),
    // Demo stub — no network. If you call an external weather API, set openWorldHint: true.
    annotations: {
      title: "Fetch Weather",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async ({ city }) => {
    const normalizedCity = city.trim();

    if (!normalizedCity) {
      return error("City is required. Please provide a city name, such as 'San Francisco'.");
    }

    return text(`The weather in ${normalizedCity} is sunny`);
  }
);

/*
 * Define MCP resources
 * Docs: https://mcp-use.com/docs/typescript/server/resources
 */
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

/*
 * Define MCP prompts
 * Docs: https://mcp-use.com/docs/typescript/server/prompts
 */
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
console.log(`Server running on port ${PORT}`);
// Start the server
server.listen(PORT);
