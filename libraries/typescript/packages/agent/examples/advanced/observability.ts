/**
 * Langfuse observability with metadata and tags.
 *
 * Run: pnpm exec tsx examples/advanced/observability.ts
 * Requires: OPENAI_API_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
 */

import { ChatOpenAI } from "@langchain/openai";
import { MCPAgent } from "@mcp-use/agent/langchain";
import { MCPClient } from "@mcp-use/client";
import { OPENAI_MODEL, simpleServerConfig } from "../_shared.js";

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY");
    process.exit(1);
  }

  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.error(
      "Missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY — set them to trace this run in Langfuse."
    );
    process.exit(1);
  }

  const client = MCPClient.fromDict(simpleServerConfig());
  const agent = new MCPAgent({
    llm: new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 }),
    client,
    maxSteps: 10,
    autoInitialize: true,
  });

  agent.setMetadata({
    agent_id: "observability-example",
    example: "agent_observability",
  });
  agent.setTags(["example", "observability"]);

  try {
    const result = await agent.run({
      prompt: "Use the add tool to calculate 9 + 11. Reply with the number only.",
    });
    console.log("Result:", result);
    await agent.flush();
    console.log("Traces flushed to Langfuse.");
  } finally {
    await agent.close();
  }
}

await main();
