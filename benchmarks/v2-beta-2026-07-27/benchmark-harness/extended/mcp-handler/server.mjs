import { serve } from "@hono/node-server";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

const port = Number(process.env.PORT ?? "43100");
const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "benchmark_echo",
      {
        description: "Return the supplied message.",
        inputSchema: { message: z.string() },
      },
      async ({ message }) => ({
        content: [{ type: "text", text: message }],
      })
    );
  },
  {},
  {
    basePath: "",
    disableSse: true,
    verboseLogs: false,
  }
);

const httpServer = serve(
  {
    fetch: (request) => handler(request),
    hostname: "0.0.0.0",
    port,
  },
  () => console.log(`ready:${port}`)
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
  });
}
