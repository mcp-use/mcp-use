import { createMCPServer } from "mcp-use/server";

const server = createMCPServer("test-app", {
  version: "1.0.0",
  description: "Test MCP server with automatic UI widget registration",
  host: process.env.HOST || "localhost",
  baseUrl: process.env.MCP_URL, // Full base URL (e.g., https://myserver.com)
});

/**
 * AUTOMATIC UI WIDGET REGISTRATION
 * All React components in the `resources/` folder are automatically registered as MCP tools and resources.
 * Just export widgetMetadata with description and Zod schema, and mcp-use handles the rest!
 *
 * It will automatically add to your MCP server:
 * - server.tool('display-weather')
 * - server.resource('ui://widget/display-weather')
 *
 * See docs: https://docs.mcp-use.com/typescript/server/ui-widgets
 */

/**
 * Add here yourtandard MCP tools, resources and prompts
 */
server.tool({
  name: "get-my-city",
  description: "Get my city",
  cb: async () => {
    return { content: [{ type: "text", text: `My city is San Francisco` }] };
  },
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const HOST = process.env.HOST || "localhost";
server.listen(PORT);
console.log(`Server running at http://${HOST}:${PORT}`);
