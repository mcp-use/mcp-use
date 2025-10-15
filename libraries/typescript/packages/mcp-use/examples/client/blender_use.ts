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
 */

import { ChatAnthropic } from '@langchain/anthropic'
import { config } from 'dotenv'
import { MCPAgent, MCPClient } from '../../index.js'

// Load environment variables from .env file
config()

async function runBlenderExample() {
  // Create MCPClient with Blender MCP configuration
  const config = { mcpServers: { blender: { command: 'uvx', args: ['blender-mcp'] } } }
  const client = MCPClient.fromDict(config)

  // Create LLM
  const llm = new ChatAnthropic({ model: 'claude-3-5-sonnet-20240620' })

  // Create agent with the client
  const agent = new MCPAgent({ llm, client, maxSteps: 30 })

  try {
    // Run the query
    const result = await agent.run(
      'Create an inflatable cube with soft material and a plane as ground.',
      30,
    )
    console.error(`\nResult: ${result}`)
  }
  finally {
    // Ensure we clean up resources properly
    await client.closeAllSessions()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBlenderExample().catch(console.error)
}
