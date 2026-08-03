import { MCPServer } from "mcp-use";

const server = new MCPServer({
  name: "notifications-example",
  version: "1.0.0",
  description: "Publishes MCP list and resource update notifications.",
});

let revision = 0;
const statusUri = "example://status";

server.resource({ name: "status", uri: statusUri }, async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({ revision }),
    },
  ],
}));

server.tool({ name: "publish-changes" }, async () => {
  revision += 1;

  // Clients that subscribed to these protocol notifications can refresh cache.
  await Promise.all([
    server.notifyToolsChanged(),
    server.notifyResourcesChanged(),
    server.notifyResourceUpdated(statusUri),
  ]);

  return {
    content: [{ type: "text", text: `Published revision ${revision}.` }],
  };
});

export default server;
