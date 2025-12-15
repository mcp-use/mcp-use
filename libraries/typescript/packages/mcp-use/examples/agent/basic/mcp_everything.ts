/**
 * This example shows how to test the different functionalities of MCPs using the MCP server from
 * anthropic.
 *
 * Required deps: @langchain/openai
 *
 * Note: Make sure to load your environment variables before running this example.
 * Required: OPENAI_API_KEY
 */

import { MCPAgent } from "../../../dist/src/agents";

const mcpServers = {
  everything: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
  },
};

async function main() {
  const agent = new MCPAgent({
    llm: "openai/gpt-5.1",
    mcpServers,
    maxSteps: 30,
  });

  const result = await agent.run({
    prompt: `Hello, you are a tester can you please answer the follwing questions:
- Which resources do you have access to?
- Which prompts do you have access to?
- Which tools do you have access to?`,
    maxSteps: 30,
  });
  console.log(`\nResult: ${result}`);
  await agent.close();
}

main().catch(console.error);
