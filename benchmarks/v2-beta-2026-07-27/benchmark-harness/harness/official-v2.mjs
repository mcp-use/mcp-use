import { createServer } from "node:http";
import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";

const port = Number(process.env.PORT ?? "43101");
const handler = createMcpHandler(
  () => {
    const server = new McpServer({
      name: "official-v2-benchmark",
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
    return server;
  },
  { legacy: "stateless" }
);
const nodeHandler = toNodeHandler(handler);
const server = createServer((request, response) => {
  void nodeHandler(request, response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ready:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
