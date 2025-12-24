/**
 * Basic usage example for mcp-use.
 *
 * This example demonstrates how to use the mcp-use library with MCPClient
 * to connect any LLM to MCP tools through a unified interface.
 *
 * Special Thanks to https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem
 * for the server.
 *
 * Note: Make sure to load your environment variables before running this example.
 * Required: OPENAI_API_KEY
 */

import { MCPAgent } from "../../../dist/src/agents";

const mcpServers = {
  filesystem: {
    command: "npx",
    args: [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "THE_PATH_TO_YOUR_DIRECTORY",
    ],
  },
};

async function main() {
  // Create agent with the client
  const agent = new MCPAgent({
    llm: "openai/gpt-5.1",
    mcpServers,
    maxSteps: 30,
  });

  // Run the query
  const result = await agent.run({
    prompt:
      "Hello can you give me a list of files and directories in the current directory",
    maxSteps: 30,
  });
  console.log(`\nResult: ${result}`);
}

main().catch(console.error);
