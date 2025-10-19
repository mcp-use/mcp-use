/**
 * Example: Using MCPAgent with Multiple Servers in the Browser
 * 
 * This example demonstrates how to use the browser-compatible MCPAgent
 * with multiple MCP servers simultaneously.
 */

import { MCPAgent, MCPClient } from 'mcp-use/browser'
import { ChatOpenAI } from '@langchain/openai'

async function multiServerExample() {
  // Create MCP client
  const client = new MCPClient()

  // Add multiple servers - the client manages all of them
  client.addServer('weather-server', {
    url: 'https://weather-mcp.example.com',
    transport: 'http',
    headers: {
      'X-API-Key': 'your-weather-api-key'
    }
  })

  client.addServer('database-server', {
    url: 'wss://database-mcp.example.com',
    transport: 'websocket',
    authToken: 'your-database-token'
  })

  client.addServer('files-server', {
    url: 'https://files-mcp.example.com',
    transport: 'http',
    headers: {
      'Authorization': 'Bearer your-files-token'
    }
  })

  // List all configured servers
  const serverNames = client.getServerNames()
  console.log('Configured servers:', serverNames)
  // Output: ['weather-server', 'database-server', 'files-server']

  // Create LLM instance
  const llm = new ChatOpenAI({
    model: 'gpt-4',
    apiKey: process.env.OPENAI_API_KEY || 'your-api-key'
  })

  // Create agent - it will have access to ALL servers
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 10,
    memoryEnabled: true,
    systemPrompt: `You are a helpful assistant with access to multiple MCP servers:
    - weather-server: provides weather information
    - database-server: provides database queries
    - files-server: provides file operations
    
    Use the appropriate server tools based on the user's request.`
  })

  // Initialize the agent - this connects to all servers
  await agent.initialize()

  // The agent can now use tools from ANY of the connected servers
  const response = await agent.run(
    'What is the weather in San Francisco? Also, query the user database for active users.'
  )
  
  console.log('Agent response:', response)

  // You can also work with individual servers
  const weatherSession = client.getSession('weather-server')
  if (weatherSession) {
    const tools = await weatherSession.listTools()
    console.log('Weather server tools:', tools.map(t => t.name))
  }

  // Close specific server session
  await client.closeSession('weather-server')

  // Or close all sessions when done
  await client.closeAllSessions()
}

// Browser usage example
async function browserExample() {
  // In a browser environment (e.g., React component)
  const client = new MCPClient()

  // Add servers dynamically
  const servers = [
    { name: 'server1', url: 'https://api1.example.com' },
    { name: 'server2', url: 'https://api2.example.com' },
    { name: 'server3', url: 'wss://api3.example.com' },
  ]

  servers.forEach(({ name, url }) => {
    client.addServer(name, { url })
  })

  // Create agent with all servers
  const agent = new MCPAgent({
    llm: new ChatOpenAI({
      model: 'gpt-4',
      apiKey: 'your-api-key' // In production, get from secure source
    }),
    client,
    maxSteps: 10,
    memoryEnabled: true,
  })

  await agent.initialize()

  // Use streaming for better UX
  for await (const event of agent.streamEvents('Your query here')) {
    if (event.event === 'on_chat_model_stream' && event.data?.chunk?.text) {
      // Display streaming text in UI
      console.log(event.data.chunk.text)
    }
    else if (event.event === 'on_tool_start') {
      // Show which tool is being called
      console.log(`Calling tool: ${event.name}`)
    }
    else if (event.event === 'on_tool_end') {
      // Show tool result
      console.log(`Tool ${event.name} completed`)
    }
  }

  await client.closeAllSessions()
}

// Run examples
if (typeof window !== 'undefined') {
  // Browser environment
  console.log('Running in browser')
  browserExample().catch(console.error)
} else {
  // Node.js environment
  console.log('Running in Node.js')
  multiServerExample().catch(console.error)
}

export { multiServerExample, browserExample }

