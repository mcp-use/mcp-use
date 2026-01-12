/**
 * Blender MCP example for mcp-use.
 *
 * This example demonstrates how to use the mcp-use library with MCPClient
 * to connect an LLM to Blender through MCP tools via WebSocket.
 * The example assumes you have installed the Blender MCP addon from:
 * https://github.com/ahujasid/blender-mcp
 *
 * Make sure the addon is enabled in Blender preferences and the WebSocket
 * server is running before executing this script.
 *
 * Special thanks to https://github.com/ahujasid/blender-mcp for the server.
 *
 * Note: Make sure to load your environment variables before running this example.
 * Required: ANTHROPIC_API_KEY
 */

import { MCPAgent } from "../../../dist/src/agents";

async function runBlenderExample() {
  // Create MCPClient with Blender MCP configuration
  const mcpServers = {
    blender: { command: "uvx", args: ["blender-mcp"] },
  };

  // Create agent with the client
  const agent = new MCPAgent({
    llm: "anthropic/claude-3-5-sonnet-20240620",
    mcpServers,
    maxSteps: 30,
  });

  try {
    // Run the query
    const result = await agent.run({
      prompt:
        "Create an inflatable cube with soft material and a plane as ground.",
      maxSteps: 30,
    });
    console.error(`\nResult: ${result}`);
  } finally {
    // Ensure we clean up resources properly
    await agent.close();
  }
}

runBlenderExample().catch(console.error);
