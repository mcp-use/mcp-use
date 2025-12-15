/**
 * Example demonstrating how to use mcp-use with Airbnb.
 *
 * This example shows how to connect an LLM to Airbnb through MCP tools
 * to perform tasks like searching for accommodations.
 *
 * Special Thanks to https://github.com/openbnb-org/mcp-server-airbnb for the server.
 *
 * Note: Make sure to load your environment variables before running this example.
 * Required: OPENAI_API_KEY
 */

import { MCPAgent } from "../../../dist/src/agents";

async function runAirbnbExample() {
  // Create MCPClient with Airbnb configuration
  const mcpServers = {
    airbnb: {
      command: "npx",
      args: ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"],
    },
  };
  // Create LLM - you can choose between different models
  // Create agent with the client
  const agent = new MCPAgent({
    llm: "openai/gpt-5.1",
    mcpServers,
    maxSteps: 30,
  });

  try {
    // Run a query to search for accommodations
    const result = await agent.run({
      prompt:
        "Find me a nice place to stay in Barcelona for 2 adults " +
        "for a week in August. I prefer places with a pool and " +
        "good reviews. Show me the top 3 options.",
      maxSteps: 30,
    });
    console.error(`\nResult: ${result}`);
  } finally {
    // Ensure we clean up resources properly
    await agent.close();
  }
}

runAirbnbExample().catch(console.error);
