import { MCPServer } from "mcp-use";

const server = new MCPServer({
  name: "security-example",
  version: "1.0.0",
  title: "Host and origin validation",
  description: "Restricts a framework-mounted MCP endpoint to its known hosts.",
  // These are additive: localhost continues to work for local development.
  // They make server.fetch reject an unrecognised Host or POST Origin.
  allowedHosts: ["api.example.com"],
  allowedOrigins: ["app.example.com"],
});

server.tool(
  { name: "status", description: "Return a fixed healthy status." },
  async () => ({ content: [{ type: "text", text: "ok" }] })
);

export default server;
