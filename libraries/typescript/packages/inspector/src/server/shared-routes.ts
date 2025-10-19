import type { Hono } from 'hono'
import type { MCPInspector } from './mcp-inspector.js'
import { handleChatRequest, handleChatRequestStream } from './shared-utils-browser.js'

/**
 * Helper function to format error responses with context and timestamp
 */
function formatErrorResponse(error: unknown, context: string) {
  const timestamp = new Date().toISOString()
  const errorMessage = error instanceof Error ? error.message : 'Unknown error'
  const errorStack = error instanceof Error ? error.stack : undefined

  // Log detailed error server-side for debugging
  console.error(`[${timestamp}] Error in ${context}:`, {
    message: errorMessage,
    stack: errorStack,
  })

  return {
    error: errorMessage,
    context,
    timestamp,
    // Only include stack in development mode
    ...(process.env.NODE_ENV === 'development' && errorStack ? { stack: errorStack } : {}),
  }
}

/**
 * Register all MCP API routes on a Hono app
 * These routes handle server connections, tools, resources, etc.
 */
export function registerMCPApiRoutes(app: Hono, mcpInspector: MCPInspector) {
  // Health check
  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // List available MCP servers
  app.get('/api/servers', async (c) => {
    try {
      const servers = await mcpInspector.listServers()
      return c.json({ servers })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('Failed to list servers:', message, error)
      return c.json({ error: 'Failed to list servers', details: message }, 500)
    }
  })

  // Connect to an MCP server
  app.post('/api/servers/connect', async (c) => {
    try {
      const { url, command } = await c.req.json()
      const server = await mcpInspector.connectToServer(url, command)
      return c.json({ server })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('Failed to connect to server:', message, error)
      return c.json({ error: 'Failed to connect to server', details: message }, 500)
    }
  })

  // Get server details
  app.get('/api/servers/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const server = await mcpInspector.getServer(id)
      if (!server) {
        return c.json({ error: 'Server not found' }, 404)
      }
      return c.json({ server })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('Failed to get server details:', message, error)
      return c.json({ error: 'Failed to get server details', details: message }, 500)
    }
  })

  // Execute a tool on a server
  app.post('/api/servers/:id/tools/:toolName/execute', async (c) => {
    try {
      const id = c.req.param('id')
      const toolName = c.req.param('toolName')
      const input = await c.req.json()

      const result = await mcpInspector.executeTool(id, toolName, input)
      return c.json({ result })
    }
    catch (error) {
      return c.json(formatErrorResponse(error, `executeTool(${c.req.param('id')}, ${c.req.param('toolName')})`), 500)
    }
  })

  // Get server tools
  app.get('/api/servers/:id/tools', async (c) => {
    try {
      const id = c.req.param('id')
      const tools = await mcpInspector.getServerTools(id)
      return c.json({ tools })
    }
    catch (error) {
      return c.json(formatErrorResponse(error, `getServerTools(${c.req.param('id')})`), 500)
    }
  })

  // Get server resources
  app.get('/api/servers/:id/resources', async (c) => {
    try {
      const id = c.req.param('id')
      const resources = await mcpInspector.getServerResources(id)
      return c.json({ resources })
    }
    catch (error) {
      return c.json(formatErrorResponse(error, `getServerResources(${c.req.param('id')})`), 500)
    }
  })

  // Disconnect from a server
  app.delete('/api/servers/:id', async (c) => {
    try {
      const id = c.req.param('id')
      await mcpInspector.disconnectServer(id)
      return c.json({ success: true })
    }
    catch (error) {
      return c.json(formatErrorResponse(error, `disconnectServer(${c.req.param('id')})`), 500)
    }
  })
}

/**
 * Register inspector-specific routes (proxy, chat, config)
 */
export function registerInspectorRoutes(app: Hono, config?: { autoConnectUrl?: string | null }) {
  // MCP Proxy endpoint - proxies MCP requests to target servers
  // WARNING: This proxy endpoint does not implement authentication.
  // For production use, consider adding authentication or restricting access to localhost only.
  app.all('/inspector/api/proxy/*', async (c) => {
    try {
      const targetUrl = c.req.header('X-Target-URL')

      if (!targetUrl) {
        return c.json({ error: 'X-Target-URL header is required' }, 400)
      }

      // Forward the request to the target MCP server
      const method = c.req.method
      const headers: Record<string, string> = {}

      // Copy relevant headers, excluding proxy-specific ones
      const requestHeaders = c.req.header()
      for (const [key, value] of Object.entries(requestHeaders)) {
        if (!key.toLowerCase().startsWith('x-proxy-')
          && !key.toLowerCase().startsWith('x-target-')
          && key.toLowerCase() !== 'host') {
          headers[key] = value
        }
      }

      // Set the target URL as the host
      try {
        const targetUrlObj = new URL(targetUrl)
        headers.Host = targetUrlObj.host
      }
      catch {
        return c.json({ error: 'Invalid target URL' }, 400)
      }

      const body = method !== 'GET' && method !== 'HEAD' ? await c.req.arrayBuffer() : undefined

      const response = await fetch(targetUrl, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
      })

      // Forward the response
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('Proxy request failed:', message, error)
      return c.json({ error: 'Proxy request failed', details: message }, 500)
    }
  })

  // Chat API endpoint - handles MCP agent chat with custom LLM key (streaming)
  app.post('/inspector/api/chat/stream', async (c) => {
    try {
      const requestBody = await c.req.json()

      // Create a readable stream from the async generator
      const { readable, writable } = new globalThis.TransformStream()
      const writer = writable.getWriter()
      const encoder = new TextEncoder()

        // Start streaming in the background
        ; (async () => {
        try {
          for await (const chunk of handleChatRequestStream(requestBody)) {
            await writer.write(encoder.encode(chunk))
          }
        }
        catch (error) {
          const errorMsg = `${JSON.stringify({
            type: 'error',
            data: { message: error instanceof Error ? error.message : 'Unknown error' },
          })}\n`
          await writer.write(encoder.encode(errorMsg))
        }
        finally {
          await writer.close()
        }
      })()

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    }
    catch (error) {
      return c.json(formatErrorResponse(error, 'handleChatRequestStream'), 500)
    }
  })

  // Chat API endpoint - handles MCP agent chat with custom LLM key (non-streaming)
  app.post('/inspector/api/chat', async (c) => {
    try {
      const requestBody = await c.req.json()
      const result = await handleChatRequest(requestBody)
      return c.json(result)
    }
    catch (error) {
      return c.json(formatErrorResponse(error, 'handleChatRequest'), 500)
    }
  })

  // Inspector config endpoint
  app.get('/inspector/config.json', (c) => {
    return c.json({
      autoConnectUrl: config?.autoConnectUrl || null,
    })
  })
}
