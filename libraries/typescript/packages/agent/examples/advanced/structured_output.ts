/**
 * Structured output with a Zod schema (LangChain agent).
 *
 * Run: pnpm exec tsx examples/advanced/structured_output.ts
 * Requires: OPENAI_API_KEY
 */

import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { MCPAgent } from "@mcp-use/agent/langchain";
import { MCPClient } from "@mcp-use/client";
import { OPENAI_MODEL, simpleServerConfig } from "../_shared.js";

const CalculationResult = z.object({
  first_number: z.number(),
  second_number: z.number(),
  result: z.number(),
  operation: z.string(),
});

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY");
    process.exit(1);
  }

  const client = MCPClient.fromDict(simpleServerConfig());
  const agent = new MCPAgent({
    llm: new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 }),
    client,
    maxSteps: 8,
    autoInitialize: true,
  });

  try {
    const result = await agent.run({
      prompt: "Use the add tool to calculate 15 + 25",
      schema: CalculationResult,
    });

    const validated = CalculationResult.parse(result);
    console.log(JSON.stringify(validated, null, 2));
  } finally {
    await agent.close();
  }
}

await main();
