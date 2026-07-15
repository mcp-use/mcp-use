/**
 * Client capability advertisement and MCP Apps metadata.
 *
 * Runs against the mcp-use v1 and v2 showcase servers on ports 3103/3104.
 */
import { MCPClient } from "@mcp-use/client";

async function inspect(
  name: string,
  url: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<void> {
  const client = new MCPClient({
    mcpServers: {
      demo: {
        url,
        clientOptions: {
          capabilities: { views: true },
        },
      },
    },
  });

  try {
    const connection = await client.connect("demo");
    const tools = await connection.listTools();
    const tool = tools.find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`${name}: missing ${toolName}`);

    const metadata = (tool as { _meta?: Record<string, unknown> })._meta ?? {};
    const result = await connection.callTool(toolName, args);
    if (connection.info.protocolEra === "modern") {
      const report = await connection.callTool(
        "report-client-capabilities",
        {}
      );
      const supportsApps = (
        report.structuredContent as { supportsApps?: boolean } | undefined
      )?.supportsApps;
      if (!supportsApps) {
        throw new Error("Modern server did not receive MCP Apps capability");
      }
    }
    console.log(
      name,
      `era=${connection.info.protocolEra}`,
      `ui=${JSON.stringify(metadata).includes("ui://")}`,
      `structured=${result.structuredContent !== undefined}`
    );
  } finally {
    await client.close();
  }
}

await inspect(
  "mcp-use-v1",
  "http://127.0.0.1:3103/mcp",
  "get-weather-delayed",
  { city: "Tokyo", delay: 0 }
);

await inspect("mcp-use-v2", "http://127.0.0.1:3104/mcp", "search-fruits", {
  query: "ap",
});
