import { McpServer } from "skybridge/server";
import { z } from "zod";

const port = Number(process.env.PORT ?? "43102");
process.env.__PORT = String(port);

const server = new McpServer({
  name: "skybridge-benchmark",
  version: "1.0.0",
});

server.registerTool(
  {
    name: "benchmark_echo",
    description: "Return the supplied message.",
    inputSchema: { message: z.string() },
  },
  ({ message }) => ({
    content: [{ type: "text", text: message }],
  })
);

await server.run();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => process.exit(0));
}
