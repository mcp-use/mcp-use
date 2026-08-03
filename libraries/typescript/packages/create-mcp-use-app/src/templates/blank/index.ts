import { MCPServer } from "mcp-use";

const server = new MCPServer({
  name: "{{PROJECT_NAME}}",
  title: "{{PROJECT_NAME}}",
  version: "1.0.0",
  description: "A blank MCP server built with mcp-use",
});

export default server;
