import { createMCPServer } from 'mcp-use/server'
import { createUIResource } from '@mcp-ui/server';

// Create an MCP server (which is also an Express app)
// The MCP Inspector is automatically mounted at /inspector
const server = createMCPServer('ui-mcp-server', {
  version: '1.0.0',
  description: 'An MCP server with React UI widgets',
})

const PORT = process.env.PORT || 3000


server.tool({
  name: 'test-tool',
  description: 'Test tool',
  inputs: [
    {
      name: 'test',
      type: 'string',
      description: 'Test input',
      required: true,
    },
  ],
  fn: async () => {
    const uiResource = createUIResource({
      uri: 'ui://widget/kanban-board',
      content: {
        type: 'externalUrl',
        iframeUrl: `http://localhost:${PORT}/mcp-use/widgets/kanban-board`
      },
      encoding: 'text',
    })
    return {
      content: [uiResource]
    }
  },
})


// MCP Resource for Kanban Board widget
server.resource({
  name: 'Kanban Board Widget',
  uri: 'ui://widget/kanban-board',
  title: 'Kanban Board Widget',
  mimeType: 'text/html+skybridge',
  description: 'Interactive Kanban board widget',
  annotations: {
    audience: ['user', 'assistant'],
    priority: 0.7
  },
  fn: async () => {
    const widgetUrl = `http://localhost:${PORT}/mcp-use/widgets/kanban-board`
    return {
      contents: [{
        uri: 'ui://widget/kanban-board',
        mimeType: 'text/uri-list',
        text: widgetUrl
      }]
    }
  },
})



// Start the server (MCP endpoints auto-mounted at /mcp)
server.listen(PORT)
