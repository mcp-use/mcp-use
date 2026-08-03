/**
 * Airbnb MCP server integration.
 *
 * Run: pnpm exec tsx examples/integrations/airbnb_use.ts
 * Requires: OPENAI_API_KEY
 */

import { MCPAgent } from "@mcp-use/agent";
import { requireEnv } from "../_shared.js";

async function main() {
  requireEnv("OPENAI_API_KEY");

  const agent = new MCPAgent({
    llm: `openai/${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`,
    mcpServers: {
      airbnb: {
        command: "npx",
        args: ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"],
      },
    },
    maxSteps: 15,
  });

  try {
    const result = await agent.run({
      prompt:
        "Search for a well-rated place to stay in Barcelona for two nights. Summarize the top option in 3 sentences.",
    });
    console.log(result);
  } finally {
    await agent.close();
  }
}

await main();
