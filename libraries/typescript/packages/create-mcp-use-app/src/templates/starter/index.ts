import { MCPServer, object, text, completable } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "{{PROJECT_NAME}}",
  title: "{{PROJECT_NAME}}", // display name
  version: "1.0.0",
  description: "Typed mcp-use starter server",
  instructions:
    "Use fetch-weather for current conditions, read config://settings before assuming user preferences, and use review-code only when the user asks for code feedback.",
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

/*
 * Define MCP tools
 * Docs: https://mcp-use.com/docs/typescript/server/tools
 */
server.tool(
  {
    name: "fetch-weather",
    title: "Fetch weather",
    description: "Fetch the weather for a city",
    schema: z.object({
      city: z.string().describe("The city to fetch the weather for"),
    }),
    // Declare outputSchema when a tool returns structuredContent so clients
    // can validate results and the model can reason about follow-up calls.
    outputSchema: z.object({
      city: z.string().describe("The city the weather is for"),
      conditions: z.string().describe("Human-readable weather conditions"),
      temperatureCelsius: z.number().describe("Current temperature in Celsius"),
    }),
    // Demo stub — no network. If you call an external weather API, set openWorldHint: true.
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  // The returned object is type-checked against the `outputSchema` above:
  // returning the wrong shape is a compile-time error.
  async ({ city }) => {
    return object({ city, conditions: "sunny", temperatureCelsius: 22 });
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

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;
console.log(`Server running on port ${PORT}`);
server.listen(PORT);
