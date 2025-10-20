import type { Hono } from 'hono'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkClientFiles, getClientDistPath, getContentType } from './shared-utils.js'

/**
 * Register static file serving routes for the inspector client
 */
export function registerStaticRoutes(app: Hono, clientDistPath?: string) {
  const distPath = clientDistPath || getClientDistPath()

  if (!checkClientFiles(distPath)) {
    console.warn(`⚠️  MCP Inspector client files not found at ${distPath}`)
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
        </body>
      </html>
    `)
    })
    return
  }

  // Serve static assets from /inspector/assets/* (matching Vite's base path)
  app.get('/inspector/assets/*', (c) => {
    const path = c.req.path.replace('/inspector/assets/', 'assets/')
    const fullPath = join(distPath, path)
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath)
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
    const indexPath = join(distPath, 'index.html')
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
        </body>
      </html>
    `)
  })
}

/**
 * Register static routes with development mode proxy support
 */
export function registerStaticRoutesWithDevProxy(app: Hono, clientDistPath?: string) {
  const distPath = clientDistPath || getClientDistPath()
  const isDev = process.env.NODE_ENV === 'development' || process.env.VITE_DEV === 'true'

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
            </body>
        </html>
      `)
    })
  }
  else {
    // Production mode: use standard static file serving
    registerStaticRoutes(app, distPath)
  }
}
