import { createServer } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { ZodJsonSchemaAdapter } from "@tmcp/adapter-zod";
import { HttpTransport } from "@tmcp/transport-http";
import { McpServer } from "tmcp";
import { z } from "zod";

const port = Number(process.env.PORT ?? "43100");
const server = new McpServer(
  { name: "tmcp-benchmark", version: "1.0.0" },
  {
    adapter: new ZodJsonSchemaAdapter(),
    capabilities: { tools: { listChanged: false } },
  }
);
server.tool(
  {
    name: "benchmark_echo",
    description: "Return the supplied message.",
    schema: z.object({ message: z.string() }),
  },
  async ({ message }) => ({
    content: [{ type: "text", text: message }],
  })
);

const transport = new HttpTransport(server, {
  path: "/mcp",
  disableSse: true,
});
const handler = toNodeHandler({
  fetch: async (request) =>
    (await transport.respond(request)) ??
    new Response("Not Found", { status: 404 }),
});
const httpServer = createServer((request, response) => {
  void handler(request, response);
});
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`ready:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
  });
}
