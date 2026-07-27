import { createServer } from "node:http";

import express from "express";
import { McpServer } from "mcp-sdk-v1/server/mcp.js";
import { StreamableHTTPServerTransport } from "mcp-sdk-v1/server/streamableHttp.js";
import { z } from "zod";

const port = Number(process.env.PORT ?? "43103");
const app = express();
app.use(express.json());
app.post("/mcp", async (request, response) => {
  const server = new McpServer({
    name: "official-v1-benchmark",
    version: "1.0.0",
  });
  server.registerTool(
    "benchmark_echo",
    {
      description: "Return the supplied message.",
      inputSchema: z.object({ message: z.string() }),
    },
    ({ message }) => ({
      content: [{ type: "text", text: message }],
    })
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response, request.body);
});

const server = createServer(app);
await new Promise((resolve, reject) => {
  server.listen(port, "127.0.0.1", resolve);
  server.once("error", reject);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
