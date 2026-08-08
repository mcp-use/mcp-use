/**
 * Filesystem MCP server integration.
 *
 * Run: pnpm exec tsx examples/integrations/filesystem_use.ts
 * Requires: OPENAI_API_KEY
 */

import { MCPAgent } from "@mcp-use/agent";
import { filesystemServerConfig, requireEnv } from "../_shared.js";

async function main() {
  requireEnv("OPENAI_API_KEY");

  const agent = new MCPAgent({
    llm: `openai/${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`,
    ...filesystemServerConfig(),
    maxSteps: 10,
  });

  try {
    const result = await agent.run({
      prompt:
        "List the files in the current directory and name the largest file you find.",
    });
    console.log(result);
  } finally {
    await agent.close();
  }
}

await main();
