import { MCPServer } from "mcp-use-v2";
import { z } from "zod";

const port = Number(process.env.PORT ?? "43100");
const server = new MCPServer({
  name: "mcp-use-v2-benchmark",
  version: "1.0.0",
  logging: { enabled: false },
  allowedHosts: ["host.docker.internal"],
});

server.tool(
  {
    name: "benchmark_echo",
    description: "Return the supplied message.",
    inputSchema: z.object({ message: z.string() }),
  },
  ({ message }) => ({
    content: [{ type: "text", text: message }],
  })
);

await server.listen(port);
console.log(`ready:${port}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
