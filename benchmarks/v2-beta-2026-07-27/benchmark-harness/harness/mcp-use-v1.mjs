import { MCPServer } from "mcp-use-v1/server";
import { z } from "zod";

const port = Number(process.env.PORT ?? "43101");
const server = new MCPServer({
  name: "mcp-use-v1-benchmark",
  version: "1.0.0",
});

server.tool(
  {
    name: "benchmark_echo",
    description: "Return the supplied message.",
    schema: z.object({ message: z.string() }),
  },
  ({ message }) => ({
    content: [{ type: "text", text: message }],
  })
);

await server.listen(port);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await server.forceClose();
    process.exit(0);
  });
}
