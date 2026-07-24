/**
 * Exercise MCP primitives via @modelcontextprotocol/server-everything.
 *
 * Run: pnpm exec tsx examples/basic/mcp_everything.ts
 * Requires: OPENAI_API_KEY
 */

import { MCPAgent } from "@mcp-use/agent";
import { requireEnv } from "../_shared.js";

async function main() {
  requireEnv("OPENAI_API_KEY");

  const agent = new MCPAgent({
    llm: `openai/${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`,
    mcpServers: {
      everything: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
      },
    },
    maxSteps: 20,
  });

  try {
    const result = await agent.run({
      prompt:
        "List the tools you have access to, then call one simple tool to demonstrate it works. Keep the answer brief.",
    });
    console.log(result);
  } finally {
    await agent.close();
  }
}

await main();
