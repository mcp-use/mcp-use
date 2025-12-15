/**
 * Basic usage example for mcp-use.
 *
 * This example demonstrates how to use the mcp-use library with MCPClient
 * to connect any LLM to MCP tools through a unified interface.
 *
 * Special thanks to https://github.com/microsoft/playwright-mcp for the server.
 *
 * Note: Make sure to load your environment variables before running this example.
 * Required: OPENAI_API_KEY
 */

import { MCPAgent } from "../../../dist/src/agents";

async function main() {
  const mcpServers = {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest"],
      env: {
        DISPLAY: ":1",
      },
    },
  };
  // Create MCPClient from config file
  // Create agent with the client
  const agent = new MCPAgent({
    llm: "openai/gpt-5.1",
    mcpServers,
    maxSteps: 30,
  });

  // Run the query
  const result = await agent.run({
    prompt: `Navigate to https://github.com/mcp-use/mcp-use, give a star to the project and write
a summary of the project.`,
    maxSteps: 30,
  });
  console.error(`\nResult: ${result}`);
}

main().catch(console.error);
