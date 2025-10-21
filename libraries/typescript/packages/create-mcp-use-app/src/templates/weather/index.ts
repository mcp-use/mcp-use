import { createMCPServer } from 'mcp-use/server'

const server = createMCPServer('test-app', {
  version: '1.0.0',
  description: 'Test MCP server',
})

server.tool({
  name: 'get-my-city',
  description: 'Get my city',
  cb: async () => {
    return { content: [{ type: 'text', text: `My city is San Francisco` }] }
  },
})

// Simplified API - automatically loads schema, description, inputs from generated schema
server.uiResource('display-weather')

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000
server.listen(PORT)
console.log(`Server running on port ${PORT}`)