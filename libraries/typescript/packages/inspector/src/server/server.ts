import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { registerInspectorRoutes } from './shared-routes.js'
import { registerStaticRoutesWithDevProxy } from './shared-static.js'
import { isPortAvailable } from './utils.js'

const execAsync = promisify(exec)

const app = new Hono()

// Middleware
app.use('*', cors())

// Register all API routes
registerInspectorRoutes(app)

// Register static file serving with dev proxy support (must be last as it includes catch-all route)
registerStaticRoutesWithDevProxy(app)

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
