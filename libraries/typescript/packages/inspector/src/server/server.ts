import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { MCPInspector } from './mcp-inspector.js'
import { checkClientFiles, getClientDistPath, getContentType, handleChatRequest, handleChatRequestStream } from './shared-utils.js'

// Helper function to format error responses with context and timestamp
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

const execAsync = promisify(exec)

// Check if a specific port is available
async function isPortAvailable(port: number): Promise<boolean> {
  const net = await import('node:net')

  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(port, () => {
      server.close(() => resolve(true))
    })
    server.on('error', () => resolve(false))
  })
}

const app = new Hono()

// Middleware
app.use('*', cors())
app.use('*', logger())

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// MCP Inspector routes
const mcpInspector = new MCPInspector()

// List available MCP servers
app.get('/api/servers', async (c) => {
  try {
    const servers = await mcpInspector.listServers()
    return c.json({ servers })
  }
  catch {
    return c.json({ error: 'Failed to list servers' }, 500)
  }
})

// Connect to an MCP server
app.post('/api/servers/connect', async (c) => {
  try {
    const { url, command } = await c.req.json()
    const server = await mcpInspector.connectToServer(url, command)
    return c.json({ server })
  }
  catch {
    return c.json({ error: 'Failed to connect to server' }, 500)
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
  catch {
    return c.json({ error: 'Failed to get server details' }, 500)
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

// Chat API endpoint - handles MCP agent chat with custom LLM key (streaming)
app.post('/inspector/api/chat/stream', async (c) => {
  try {
    const requestBody = await c.req.json()

    // Create a readable stream from the async generator
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    // Start streaming in the background
    ;(async () => {
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
    return c.json(formatErrorResponse(error, 'proxyRequest'), 500)
  }
})

// Inspector config endpoint
app.get('/inspector/config.json', (c) => {
  return c.json({
    autoConnectUrl: null,
  })
})

// Check if we're in development mode (Vite dev server running)
const isDev = process.env.NODE_ENV === 'development' || process.env.VITE_DEV === 'true'

// Serve static assets from the built client
const clientDistPath = getClientDistPath()

if (isDev) {
  // Development mode: proxy client requests to Vite dev server
  console.warn('🔧 Development mode: Proxying client requests to Vite dev server')

  // Proxy all non-API requests to Vite dev server
  app.get('*', async (c) => {
    const path = c.req.path

    // Skip API routes - both /api/ and /inspector/api/
    if (path.startsWith('/api/') || path.startsWith('/inspector/api/') || path === '/inspector/config.json') {
      return c.notFound()
    }

    try {
      // Vite dev server should be running on port 3000
      const viteUrl = `http://localhost:3000${path}`
      const response = await fetch(viteUrl, {
        signal: AbortSignal.timeout(1000), // 1 second timeout
      })

      if (response.ok) {
        const content = await response.text()
        const contentType = response.headers.get('content-type') || 'text/html'

        c.header('Content-Type', contentType)
        return c.html(content)
      }
    }
    catch (error) {
      console.warn(`Failed to proxy to Vite dev server: ${error}`)
    }

    // Fallback HTML if Vite dev server is not running
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>MCP Inspector - Development</title>
        </head>
        <body>
          <h1>MCP Inspector - Development Mode</h1>
          <p>Vite dev server is not running. Please start it with:</p>
          <pre>yarn dev:client</pre>
          <p>API is available at <a href="/api/servers">/api/servers</a></p>
        </body>
      </html>
    `)
  })
}
else if (checkClientFiles(clientDistPath)) {
  // Production mode: serve static assets from built client
  // Serve static assets from /inspector/assets/* (matching Vite's base path)
  app.get('/inspector/assets/*', async (c) => {
    const path = c.req.path.replace('/inspector/assets/', 'assets/')
    const fullPath = join(clientDistPath, path)

    if (existsSync(fullPath)) {
      const content = await import('node:fs').then(fs => fs.readFileSync(fullPath))

      // Set appropriate content type based on file extension
      const contentType = getContentType(fullPath)
      c.header('Content-Type', contentType)

      return c.body(content)
    }

    return c.notFound()
  })

  // Redirect root path to /inspector
  app.get('/', (c) => {
    return c.redirect('/inspector')
  })

  // Serve the main HTML file for /inspector and all other routes (SPA routing)
  app.get('*', (c) => {
    const indexPath = join(clientDistPath, 'index.html')
    if (existsSync(indexPath)) {
      const content = import('node:fs').then(fs => fs.readFileSync(indexPath, 'utf-8'))
      return c.html(content)
    }
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>MCP Inspector</title>
        </head>
        <body>
          <h1>MCP Inspector</h1>
          <p>Client files not found. Please run 'yarn build' to build the UI.</p>
          <p>API is available at <a href="/api/servers">/api/servers</a></p>
        </body>
      </html>
    `)
  })
}
else {
  console.warn(`⚠️  MCP Inspector client files not found at ${clientDistPath}`)
  console.warn(`   Run 'yarn build' in the inspector package to build the UI`)

  // Fallback for when client is not built
  app.get('*', (c) => {
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>MCP Inspector</title>
        </head>
        <body>
          <h1>MCP Inspector</h1>
          <p>Client files not found. Please run 'yarn build' to build the UI.</p>
          <p>API is available at <a href="/api/servers">/api/servers</a></p>
        </body>
      </html>
    `)
  })
}

// Start the server
async function startServer() {
  try {
    // In development mode, use port 3001 for API server
    // In production/standalone mode, try 3001 first, then 3002 as fallback
    const isDev = process.env.NODE_ENV === 'development' || process.env.VITE_DEV === 'true'

    let port = 3001
    const available = await isPortAvailable(port)

    if (!available) {
      if (isDev) {
        console.error(`❌ Port ${port} is not available. Please stop the process using this port and try again.`)
        process.exit(1)
      }
      else {
        // In standalone mode, try fallback port
        const fallbackPort = 3002
        console.warn(`⚠️  Port ${port} is not available, trying ${fallbackPort}`)
        const fallbackAvailable = await isPortAvailable(fallbackPort)

        if (!fallbackAvailable) {
          console.error(`❌ Neither port ${port} nor ${fallbackPort} is available. Please stop the processes using these ports and try again.`)
          process.exit(1)
        }

        port = fallbackPort
      }
    }

    serve({
      fetch: app.fetch,
      port,
    })

    if (isDev) {
      console.warn(`🚀 MCP Inspector API server running on http://localhost:${port}`)
      console.warn(`🌐 Vite dev server should be running on http://localhost:3000`)
    }
    else {
      console.warn(`🚀 MCP Inspector running on http://localhost:${port}`)
    }

    // Auto-open browser in development
    if (process.env.NODE_ENV !== 'production') {
      try {
        const command = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
        const url = isDev ? 'http://localhost:3000' : `http://localhost:${port}`
        await execAsync(`${command} ${url}`)
        console.warn(`🌐 Browser opened automatically`)
      }
      catch {
        const url = isDev ? 'http://localhost:3000' : `http://localhost:${port}`
        console.warn(`🌐 Please open ${url} in your browser`)
      }
    }

    return { port, fetch: app.fetch }
  }
  catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer()
}

export default { startServer }
