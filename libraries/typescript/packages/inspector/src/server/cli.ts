#!/usr/bin/env node

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import open from 'open'
import { registerInspectorRoutes } from './shared-routes.js'
import { registerStaticRoutes } from './shared-static.js'
import { findAvailablePort, isValidUrl } from './utils.js'

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
  }
  else if (args[i] === '--port' && i + 1 < args.length) {
    const parsedPort = Number.parseInt(args[i + 1], 10)
    if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      console.error(`Error: Port must be a number between 1 and 65535, got: ${args[i + 1]}`)
      process.exit(1)
    }
    startPort = parsedPort
    i++
  }
  else if (args[i] === '--help' || args[i] === '-h') {
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
// Apply logger middleware only to proxy routes
app.use('/inspector/api/proxy/*', logger())

registerInspectorRoutes(app, { autoConnectUrl: mcpUrl })

// Register static file serving (must be last as it includes catch-all route)
registerStaticRoutes(app)

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
      await open(`http://localhost:${port}/inspector`)
      console.log(`🌐 Browser opened`)
    }
    catch {
      console.log(`🌐 Please open http://localhost:${port}/inspector in your browser`)
    }
    return { port, fetch: app.fetch }
  }
  catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Start the server
startServer()
