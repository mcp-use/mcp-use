#!/usr/bin/env node

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import open from 'open'
import { MCPInspector } from '../server/mcp-inspector.js'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Validate URL format
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ws:' || url.protocol === 'wss:'
  } catch {
    return false
  }
}

// Find available port starting from 8080
async function findAvailablePort(startPort = 8080, maxAttempts = 100): Promise<number> {
  const net = await import('node:net')
  
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = net.createServer()
        server.listen(port, () => {
          server.close(() => resolve())
        })
        server.on('error', (err) => reject(err))
      })
      return port
    } catch (error) {
      // Port is in use, try next one
      continue
    }
  }
  throw new Error(`No available port found after trying ${maxAttempts} ports starting from ${startPort}`)
}

// Parse command line arguments
const args = process.argv.slice(2)
let mcpUrl: string | undefined
let startPort = 8080

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && i + 1 < args.length) {
    const url = args[i + 1]
    if (!isValidUrl(url)) {
      console.error(`Error: Invalid URL format: ${url}`)
      console.error('URL must start with http://, https://, ws://, or wss://')
      process.exit(1)
    }
    mcpUrl = url
    i++
  } else if (args[i] === '--port' && i + 1 < args.length) {
    const parsedPort = Number.parseInt(args[i + 1], 10)
    if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      console.error(`Error: Port must be a number between 1 and 65535, got: ${args[i + 1]}`)
      process.exit(1)
    }
    startPort = parsedPort;
    i++
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
MCP Inspector - Inspect and debug MCP servers

Usage:
  npx @mcp-use/inspector [options]

Options:
  --url <url>    MCP server URL to auto-connect to (e.g., http://localhost:3000/mcp)
  --port <port>  Starting port to try (default: 8080, will find next available)
  --help, -h     Show this help message

Examples:
  # Run inspector with auto-connect
  npx @mcp-use/inspector --url http://localhost:3000/mcp

  # Run starting from custom port
  npx @mcp-use/inspector --url http://localhost:3000/mcp --port 9000

  # Run without auto-connect
  npx @mcp-use/inspector
`)
    process.exit(0)
  }
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
    // Validate URL format for security
    if (url && !isValidUrl(url)) {
      return c.json({ error: 'Invalid URL format. Must start with http://, https://, ws://, or wss://' }, 400)
    }
    
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
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to execute tool:', message, error)
    return c.json({ error: 'Failed to execute tool', details: message }, 500)
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
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to get server tools:', message, error)
    return c.json({ error: 'Failed to get server tools', details: message }, 500)
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
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to get server resources:', message, error)
    return c.json({ error: 'Failed to get server resources', details: message }, 500)
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
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to disconnect server:', message, error)
    return c.json({ error: 'Failed to disconnect server', details: message }, 500)
  }
})

// Serve static assets from the built client
const clientDistPath = join(__dirname, '../../dist/client')

if (existsSync(clientDistPath)) {
  // Serve static assets from /inspector/assets/* (matching Vite's base path)
  app.get('/inspector/assets/*', (c) => {
    const path = c.req.path.replace('/inspector/assets/', 'assets/')
    const fullPath = join(clientDistPath, path)
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath)
        // Set appropriate content type based on file extension
      if (path.endsWith('.js')) {
        c.header('Content-Type', 'application/javascript')
      } else if (path.endsWith('.css')) {
        c.header('Content-Type', 'text/css')
      } else if (path.endsWith('.svg')) {
        c.header('Content-Type', 'image/svg+xml')
      }
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
      const content = readFileSync(indexPath, 'utf-8')
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
} else {
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

// Start the server with automatic port selection
async function startServer() {
  try {
    const port = await findAvailablePort(startPort)
    serve({
      fetch: app.fetch,
      port,
    })
    console.log(`🚀 MCP Inspector running on http://localhost:${port}`)
    if (mcpUrl) {
      console.log(`📡 Auto-connecting to: ${mcpUrl}`)
    }
    // Auto-open browser
    try {
      await open(`http://localhost:${port}`)
      console.log(`🌐 Browser opened`)
    } catch {
      console.log(`🌐 Please open http://localhost:${port} in your browser`)
    }
    return { port, fetch: app.fetch }
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Start the server
startServer()

