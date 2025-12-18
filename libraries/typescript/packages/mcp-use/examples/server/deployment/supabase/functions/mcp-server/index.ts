// MCP Server deployed on Supabase Edge Functions
import { MCPServer, text } from "npm:mcp-use/server";

const server = new MCPServer({
  name: "test-app",
  version: "1.0.0",
  description:
    "Test MCP server with automatic UI widget registration deployed on Supabase",
});

// Register tools from the original index.ts
server.tool(
  {
    name: "get-my-city",
    description: "Get my city",
  },
  async () => {
    return text(`My city is San Francisco`);
  }
);

// Start the server - automatically handles CORS for Deno/Supabase
server.listen().catch(console.error);
