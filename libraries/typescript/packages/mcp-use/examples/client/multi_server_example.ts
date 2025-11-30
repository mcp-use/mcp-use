/**
 * Example demonstrating how to use MCPClient with multiple servers.
 *
 * This example shows how to:
 * 1. Configure multiple MCP servers
 * 2. Create and manage sessions for each server
 * 3. Use tools from different servers in a single agent
 *
 * Note: Make sure to load your environment variables before running this example.
 * Required: ANTHROPIC_API_KEY
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { MCPAgent, MCPClient } from "../../index.js";

async function runMultiServerExample() {
  // Create a configuration with multiple servers
  const config = {
    mcpServers: {
      airbnb: {
        command: "npx",
        args: ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"],
      },
      playwright: {
        command: "npx",
        args: ["@playwright/mcp@latest"],
        env: { DISPLAY: ":1" },
      },
      filesystem: {
        command: "npx",
        args: [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          "YOUR_DIRECTORY_HERE",
        ],
      },
    },
  };

  // Create MCPClient with the multi-server configuration
  const client = MCPClient.fromDict(config);

  // Create LLM
  const llm = new ChatAnthropic({ model: "claude-3-5-sonnet-20240620" });

  // Create agent with the client
  const agent = new MCPAgent({ llm, client, maxSteps: 30 });

  // Example 1: Using tools from different servers in a single query
  const result = await agent.run(
    "Search for a nice place to stay in Barcelona on Airbnb, " +
      "then use Google to find nearby restaurants and attractions." +
      "Write the result in the current directory in restarant.txt",
    30
  );
  console.log(result);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMultiServerExample().catch(console.error);
}
