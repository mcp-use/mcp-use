/**
 * Multiple MCP servers in one agent (native simplified mode).
 *
 * Run: pnpm exec tsx examples/server-management/multi_server_example.ts
 * Requires: ANTHROPIC_API_KEY, external MCP servers (airbnb, filesystem)
 */

import { MCPAgent } from "@mcp-use/agent";
import { requireEnv } from "../_shared.js";

async function main() {
  requireEnv("ANTHROPIC_API_KEY");

  const agent = new MCPAgent({
    llm: `anthropic/${process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001"}`,
    mcpServers: {
      airbnb: {
        command: "npx",
        args: ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"],
      },
      filesystem: {
        command: "npx",
        args: [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          process.cwd(),
        ],
      },
    },
    maxSteps: 20,
  });

  try {
    const result = await agent.run({
      prompt:
        "Search Airbnb for a stay in Barcelona for one night, then write a one-line summary to a file named trip.txt in the current directory using filesystem tools.",
    });
    console.log(result);
  } finally {
    await agent.close();
  }
}

await main();
