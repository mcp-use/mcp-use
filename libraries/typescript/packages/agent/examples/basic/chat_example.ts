/**
 * Interactive chat with built-in conversation memory.
 *
 * Run: pnpm exec tsx examples/basic/chat_example.ts
 * Demo (non-interactive): AGENT_EXAMPLE_DEMO=1 pnpm exec tsx examples/basic/chat_example.ts
 * Requires: OPENAI_API_KEY
 */

import readline from "node:readline";
import { MCPAgent } from "@mcp-use/agent";
import { filesystemServerConfig, requireEnv } from "../_shared.js";

async function runMemoryChat() {
  requireEnv("OPENAI_API_KEY");

  const agent = new MCPAgent({
    llm: `openai/${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`,
    ...filesystemServerConfig(),
    maxSteps: 15,
  });

  if (process.env.AGENT_EXAMPLE_DEMO === "1") {
    try {
      const reply = await agent.run({
        prompt: "Say hello in one sentence.",
      });
      console.log("Assistant:", reply);
      agent.clearConversationHistory();
      console.log("History cleared (demo).");
    } finally {
      await agent.close();
    }
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string) =>
    new Promise<string>((resolve) => rl.question(prompt, resolve));

  console.error("Interactive MCP chat — type exit to quit, clear to reset memory");

  try {
    while (true) {
      const userInput = await question("\nYou: ");
      if (["exit", "quit"].includes(userInput.toLowerCase())) break;
      if (userInput.toLowerCase() === "clear") {
        agent.clearConversationHistory();
        console.error("Conversation history cleared.");
        continue;
      }

      const response = await agent.run({ prompt: userInput });
      console.log("\nAssistant:", response);
    }
  } finally {
    rl.close();
    await agent.close();
  }
}

await runMemoryChat();
