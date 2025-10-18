import { createMCPServer } from 'mcp-use/server'

// Create an MCP server (which is also an Express app)
// The MCP Inspector is automatically mounted at /inspector
const server = createMCPServer('simple-example-server', {
  version: '1.0.0',
  description: 'A simple MCP server example',
})

console.log('Server type:', typeof server)
console.log('Server has tool method:', 'tool' in server)
console.log('Server tool method:', typeof server.tool)
console.log('Server keys:', Object.keys(server))
console.log('Server prototype:', Object.getOwnPropertyNames(Object.getPrototypeOf(server)))


const PORT = process.env.PORT || 3000

// Simple tool that returns hello world
server.tool({
  name: 'hello-world',
  description: 'A simple tool that returns hello world',
  inputs: [],
  cb: async () => {
    return {
      content: [
        {
          type: 'text',
          text: 'Hello World!'
        }
      ]
    }
  },
})

server.resource({
  name: 'test',
  uri: 'resource://test',
  title: 'Test Resource',
  mimeType: 'text/plain',
  description: 'A test resource that returns a simple greeting',
  annotations: {
    audience: ['user', 'assistant'],
    priority: 0.5
  },
  readCallback: async () => {
    return {
      contents: [{
        uri: 'resource://test',
        mimeType: 'text/plain',
        text: 'ciao'
      }]
    }
  }
})

// Start the server (MCP endpoints auto-mounted at /mcp)
server.listen(PORT, () => {
  console.log(`🚀 Simple Example Server running on port ${PORT}`)
  console.log(`📊 Inspector available at http://localhost:${PORT}/inspector`)
  console.log(`🔧 MCP endpoint at http://localhost:${PORT}/mcp`)
})
