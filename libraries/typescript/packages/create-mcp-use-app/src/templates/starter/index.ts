import { MCPServer } from "mcp-use/server";
import { z } from "zod";

// Create MCP server instance
const server = new MCPServer({
  name: "my-mcp-server",
  version: "1.0.0",
  description: "My first MCP server with all features",
  baseUrl: process.env.MCP_URL || "http://localhost:3000", // Full base URL (e.g., https://myserver.com)
  // favicon: "favicon.ico", // Uncomment and add your favicon to public/ folder
});

/**
 * Define UI Widgets
 * All React components in the `resources/` folder
 * are automatically registered as MCP tools and resources.
 *
 * Just export widgetMetadata with description and Zod schema,
 * and mcp-use handles the rest!
 *
 * It will automatically add to your MCP server:
 * - server.tool('kanban-board')
 * - server.tool('display-weather')
 * - server.resource('ui://widget/kanban-board')
 * - server.resource('ui://widget/display-weather')
 *
 * Docs: https://mcp-use.com/docs/typescript/server/ui-widgets
 */

/*
 * Define MCP tools
 * Docs: https://mcp-use.com/docs/typescript/server/tools
 */
server.tool(
  {
    name: "fetch-weather",
    description: "Fetch the weather for a city",
    schema: z.object({
      city: z.string().describe("The city to fetch the weather for"),
    }),
  },
  async ({ city }) => {
    const response = await fetch(`https://wttr.in/${city}?format=j1`);
    const data: any = await response.json();
    const current = data.current_condition[0];
    return {
      content: [
        {
          type: "text",
          text: `The weather in ${city} is ${current.weatherDesc[0].value}. Temperature: ${current.temp_C}°C, Humidity: ${current.humidity}%`,
        },
      ],
    };
  }
);

/*
 * Define MCP resources
 * Docs: https://mcp-use.com/docs/typescript/server/resources
 */
server.resource({
  name: "config",
  uri: "config://settings",
  mimeType: "application/json",
  description: "Server configuration",
  readCallback: async () => ({
    contents: [
      {
        uri: "config://settings",
        mimeType: "application/json",
        text: JSON.stringify({
          theme: "dark",
          language: "en",
        }),
      },
    ],
  }),
});

/*
 * Define MCP prompts
 * Docs: https://mcp-use.com/docs/typescript/server/prompts
 */
server.prompt(
  {
    name: "review-code",
    description: "Review code for best practices and potential issues",
    args: [{ name: "code", type: "string", required: true }],
  },
  async (params: Record<string, any>) => {
    const { code } = params;
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please review this code:\n\n${code}`,
          },
        },
      ],
    };
  }
);

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
console.log(`Server running on port ${PORT}`);
// Start the server
server.listen(PORT);
