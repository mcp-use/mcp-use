/**
 * Simplified MCPAgent API — provider/model string + mcpServers config.
 *
 * Run: pnpm exec tsx examples/basic/simplified_agent_example.ts
 * Requires: OPENAI_API_KEY
 */

import { MCPAgent } from "@mcp-use/agent";
import { filesystemServerConfig, requireEnv } from "../_shared.js";

async function simplifiedModeExample() {
  requireEnv("OPENAI_API_KEY");

  const agent = new MCPAgent({
    llm: `openai/${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`,
    ...filesystemServerConfig(),
    systemPrompt:
      "You are a helpful assistant with access to file system tools.",
    maxSteps: 10,
  });

  try {
    const result = await agent.run({
      prompt: "List the top 5 files in the current directory",
    });
    console.log("Result:\n", result);
  } finally {
    await agent.close();
  }
}

async function simplifiedModeWithConfigExample() {
  requireEnv("OPENAI_API_KEY");

  const agent = new MCPAgent({
    llm: `openai/${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`,
    llmConfig: { temperature: 0.3, maxTokens: 1000 },
    ...filesystemServerConfig(),
    systemPrompt: "You are a concise assistant.",
    maxSteps: 10,
  });

  try {
    const result = await agent.run({
      prompt: "What files are in this directory? Reply in one short paragraph.",
    });
    console.log("Result:\n", result);
  } finally {
    await agent.close();
  }
}

await simplifiedModeExample();
await simplifiedModeWithConfigExample();
