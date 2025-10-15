/**
 * This example shows how to test the different functionalities of MCPs using the MCP server from
 * anthropic.
 */

import { ChatOpenAI } from '@langchain/openai'
import { config } from 'dotenv'
import { MCPAgent, MCPClient } from '../../index.js'

// Load environment variables from .env file
config()

const everythingServer = {
  mcpServers: { everything: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] } },
}

async function main() {
  const client = new MCPClient(everythingServer)
  const llm = new ChatOpenAI({ model: 'gpt-4o', temperature: 0 })
  const agent = new MCPAgent({ llm, client, maxSteps: 30 })

  const result = await agent.run(
    `Hello, you are a tester can you please answer the follwing questions:
- Which resources do you have access to?
- Which prompts do you have access to?
- Which tools do you have access to?`,
    30,
  )
  console.log(`\nResult: ${result}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}
