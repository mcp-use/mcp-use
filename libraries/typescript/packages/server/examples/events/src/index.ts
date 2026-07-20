import { MCPServer } from "mcp-use";

const server = new MCPServer({
  name: "events-example",
  version: "1.0.0",
  description: "Observes MCP operations without intercepting them.",
});

const observations: string[] = [];

server.on("mcp:tools/list", (ctx) => {
  observations.push("tools/list:before");
  observations.push(
    `request-id:${ctx.request?.headers.get("x-example-request-id") ?? "none"}`
  );
});

server.on("mcp:tools/list:complete", () => {
  // Completion observers run after the protocol handler has produced its result.
  observations.push("tools/list:complete");
});

server.tool({ name: "ping" }, async () => ({
  content: [{ type: "text", text: "pong" }],
}));

server.tool({ name: "recent-events" }, async () => ({
  content: [{ type: "text", text: JSON.stringify(observations) }],
}));

server.resource(
  { name: "observations", uri: "events://observations" },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(observations),
      },
    ],
  })
);

export default server;
