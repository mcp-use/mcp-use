/**
 * Example demonstrating how to use mcp-use with Airbnb.
 *
 * This example shows how to connect an LLM to Airbnb through MCP tools
 * to perform tasks like searching for accommodations.
 *
 * Special Thanks to https://github.com/openbnb-org/mcp-server-airbnb for the server.
 */

import { ChatOpenAI } from '@langchain/openai'
import { config } from 'dotenv'
import { MCPAgent, MCPClient } from '../../index.js'

// Load environment variables from .env file
config()

async function runAirbnbExample() {
  // Create MCPClient with Airbnb configuration
  const config = {
    mcpServers: {
      airbnb: {
        command: 'npx',
        args: ['-y', '@openbnb/mcp-server-airbnb', '--ignore-robots-txt'],
      },
    },
  }
  const client = new MCPClient(config)
  // Create LLM - you can choose between different models
  const llm = new ChatOpenAI({ model: 'gpt-4o' })

  // Create agent with the client
  const agent = new MCPAgent({ llm, client, maxSteps: 30 })

  try {
    // Run a query to search for accommodations
    const result = await agent.run(
      'Find me a nice place to stay in Barcelona for 2 adults '
      + 'for a week in August. I prefer places with a pool and '
      + 'good reviews. Show me the top 3 options.',
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
  runAirbnbExample().catch(console.error)
}
