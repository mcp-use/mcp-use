import { createMCPServer } from 'mcp-use/server'
import { getPizzazUIResources, getPizzazWidgetsSummary } from './widgets.js'

/**
 * ════════════════════════════════════════════════════════════════════
 * Pizzaz MCP Server - OpenAI Apps SDK Reference Implementation
 * ════════════════════════════════════════════════════════════════════
 * 
 * This server demonstrates OpenAI Apps SDK integration using mcp-use's
 * uiResource method. It implements the pizzaz reference widgets that
 * showcase best practices for Apps SDK widgets.
 * 
 * Key Features:
 * - Apps SDK metadata (CSP, tool invocation status, widget description)
 * - External resource loading (OpenAI CDN assets)
 * - Structured content injection via window.openai.toolOutput
 * - text/html+skybridge MIME type for Apps SDK compatibility
 * - Automatic tool and resource registration
 */

// Create the MCP server
const server = createMCPServer('pizzaz-node', {
  version: '0.1.0',
  description: 'OpenAI Apps SDK reference implementation with pizzaz widgets',
})

const PORT = process.env.PORT || 8000

/**
 * ════════════════════════════════════════════════════════════════════
 * Register Pizzaz Widgets
 * ════════════════════════════════════════════════════════════════════
 * 
 * Using mcp-use's uiResource method with AppsSdkUIResource type:
 * 
 * This automatically:
 * 1. Creates tools (pizza-map, pizza-carousel, etc.)
 * 2. Creates resources (ui://widget/pizza-map.html, etc.)
 * 3. Sets MIME type to text/html+skybridge
 * 4. Injects Apps SDK metadata
 * 5. Handles structuredContent injection
 */

const pizzazWidgets = getPizzazUIResources()

pizzazWidgets.forEach(widget => {
  server.uiResource(widget)
})

/**
 * ════════════════════════════════════════════════════════════════════
 * Helper Tools
 * ════════════════════════════════════════════════════════════════════
 * 
 * Additional tools for discovering and testing widgets
 */

server.tool({
  name: 'list-widgets',
  title: 'List Available Widgets',
  description: 'Get a list of all available pizzaz widgets',
  cb: async () => {
    const widgets = getPizzazWidgetsSummary()

    return {
      content: [{
        type: 'text',
        text: `Available Pizzaz Widgets (${widgets.length} total):\n\n${widgets.map(w =>
          `🍕 ${w.title}\n` +
          `   ID: ${w.id}\n` +
          `   Tool: ${w.tool}\n` +
          `   Resource: ${w.resource}\n` +
          `   Description: ${w.description}\n`
        ).join('\n')}\n` +
          `\nUsage:\n` +
          `await client.callTool('${widgets[0].id}', { pizzaTopping: 'pepperoni' })\n` +
          `await client.readResource('${widgets[0].resource}')`
      }]
    }
  }
})

server.tool({
  name: 'get-widget-info',
  title: 'Get Widget Information',
  description: 'Get detailed information about a specific widget',
  inputs: [{
    name: 'widgetId',
    type: 'string',
    description: 'Widget ID (e.g., pizza-map, pizza-carousel)',
    required: true
  }],
  cb: async (params) => {
    const widgets = getPizzazWidgetsSummary()
    const widget = widgets.find(w => w.id === params.widgetId)

    if (!widget) {
      return {
        content: [{
          type: 'text',
          text: `Widget '${params.widgetId}' not found. Available widgets: ${widgets.map(w => w.id).join(', ')}`
        }]
      }
    }

    return {
      content: [{
        type: 'text',
        text: `Widget Information:\n\n` +
          `ID: ${widget.id}\n` +
          `Title: ${widget.title}\n` +
          `Description: ${widget.description}\n` +
          `Tool Name: ${widget.tool}\n` +
          `Resource URI: ${widget.resource}\n` +
          `Response Text: ${widget.responseText}\n\n` +
          `Usage:\n` +
          `await client.callTool('${widget.tool}', { pizzaTopping: 'mushroom' })\n` +
          `await client.readResource('${widget.resource}')`
      }]
    }
  }
})

/**
 * ════════════════════════════════════════════════════════════════════
 * Server Configuration Resource
 * ════════════════════════════════════════════════════════════════════
 */

server.resource({
  name: 'server-config',
  uri: 'config://server',
  title: 'Server Configuration',
  description: 'Current server configuration and capabilities',
  mimeType: 'application/json',
  readCallback: async () => ({
    contents: [{
      uri: 'config://server',
      mimeType: 'application/json',
      text: JSON.stringify({
        name: 'pizzaz-node',
        version: '0.1.0',
        port: PORT,
        widgets: {
          total: pizzazWidgets.length,
          ids: pizzazWidgets.map(w => w.name)
        },
        endpoints: {
          mcp: `http://localhost:${PORT}/mcp`,
          inspector: `http://localhost:${PORT}/inspector`,
        },
        features: {
          appsSdk: true,
          externalResources: true,
          structuredContent: true,
          pizzazWidgets: true
        },
        appsSdk: {
          mimeType: 'text/html+skybridge',
          metadata: [
            'openai/widgetDescription',
            'openai/widgetCSP',
            'openai/widgetAccessible',
            'openai/outputTemplate',
            'openai/toolInvocation/invoking',
            'openai/toolInvocation/invoked',
            'openai/resultCanProduceWidget'
          ]
        }
      }, null, 2)
    }]
  })
})

/**
 * ════════════════════════════════════════════════════════════════════
 * Start the Server
 * ════════════════════════════════════════════════════════════════════
 */

server.listen(PORT)

// Display helpful startup message
console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🍕 Pizzaz MCP Server - Apps SDK Reference           ║
╚═══════════════════════════════════════════════════════════════╝

Server is running on port ${PORT}

📍 Endpoints:
   MCP Protocol:  http://localhost:${PORT}/mcp
   Inspector UI:  http://localhost:${PORT}/inspector

🍕 Available Pizzaz Widgets (${pizzazWidgets.length} total):

${pizzazWidgets.map((w, i) => `   ${i + 1}. ${w.name}
      Tool:      ${w.name}
      Resource:  ${w.appsSdkMetadata?.['openai/outputTemplate'] || 'N/A'}
`).join('\n')}

📝 Usage Examples:

   // Call a widget tool with parameters
   await client.callTool('pizza-map', {
     pizzaTopping: 'pepperoni'
   })

   // Access widget template as resource
   await client.readResource('ui://widget/pizza-map.html')

   // List all widgets
   await client.callTool('list-widgets', {})

   // Get widget info
   await client.callTool('get-widget-info', {
     widgetId: 'pizza-map'
   })

🔧 Apps SDK Features:
   ✓ text/html+skybridge MIME type
   ✓ External resource loading (OpenAI CDN)
   ✓ Structured content injection
   ✓ Tool invocation status messages
   ✓ Content Security Policy (CSP)
   ✓ Widget accessibility metadata

💡 Tip: Open the Inspector UI to test all widgets interactively!
🎨 These widgets demonstrate OpenAI's Apps SDK best practices.
`)

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down pizzaz server...')
  process.exit(0)
})

export default server

