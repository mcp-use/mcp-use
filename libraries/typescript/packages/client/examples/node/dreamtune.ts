/** Discover Dreamtune MCP tools or invoke one explicitly; see dreamtune.md. */
import { parseArgs } from "node:util";
import { MCPClient } from "@mcp-use/client";
import { z } from "zod";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tool: { type: "string" },
      arguments: { type: "string" },
    },
  });
  const key = process.env.DREAMTUNE_API_KEY;
  if (!key) throw new Error("Set DREAMTUNE_API_KEY to your workspace API key");
  const input = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(values.arguments ?? "{}"));

  const client = new MCPClient({
    mcpServers: {
      dreamtune: {
        command: "npx",
        args: ["-y", "--package", "@dreamtune/sdk@0.1.2", "dreamtune-mcp"],
        env: {
          DREAMTUNE_API_KEY: key,
          DREAMTUNE_API_ORIGIN: "https://api.dreamtunelabs.com",
          DREAMTUNE_REQUEST_TIMEOUT_MS: "60000",
        },
      },
    },
  });

  try {
    const connection = await client.connect("dreamtune");
    const tools = await connection.listTools();
    if (values.tool) {
      if (!tools.some((tool) => tool.name === values.tool)) {
        throw new Error(
          "Unknown tool; run without --tool to list available names"
        );
      }
      const result = await connection.callTool(values.tool, input);
      console.log(JSON.stringify(result, null, 2));
      if (result.isError) process.exitCode = 1;
    } else {
      for (const tool of tools) {
        console.log(`${tool.name}: ${tool.description ?? ""}`);
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
