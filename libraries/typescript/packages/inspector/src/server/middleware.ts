import type { Express, NextFunction, Request, Response } from 'express'
import { Hono } from 'hono'
import { registerInspectorRoutes } from './shared-routes.js'
import { registerStaticRoutesWithDevProxy } from './shared-static.js'
import {
  checkClientFiles,
  getClientDistPath,
} from './shared-utils.js'

/**
 * Mount the MCP Inspector UI at a specified path on an Express or Hono app
 * Similar to how FastAPI mounts Swagger UI at /docs
 *
 * @param app - Express or Hono application instance
 *
 * @example
 * ```typescript
 * import { createMCPServer } from 'mcp-use/server'
 * import { mountInspector } from '@mcp-use/inspector'
 *
 * const server = createMCPServer('my-server')
 * mountInspector(server) // Mounts at /inspector
 * ```
 */
export function mountInspector(app: Express | Hono): void {
  // Find the built client files
  const clientDistPath = getClientDistPath()

  if (!checkClientFiles(clientDistPath)) {
    console.warn(`⚠️  MCP Inspector client files not found at ${clientDistPath}`)
    console.warn(`   Run 'yarn build' in the inspector package to build the UI`)
  }

  // If it's already a Hono app, register routes directly
  if (app instanceof Hono) {
    registerInspectorRoutes(app)
    registerStaticRoutesWithDevProxy(app)
    return
  }

  // For Express apps, create a Hono app and bridge the requests
  const honoApp = new Hono()

  // Register routes on Hono app
  registerInspectorRoutes(honoApp)
  registerStaticRoutesWithDevProxy(honoApp)

  // Convert all Hono routes to Express middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Use Hono's fetch API
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    })

    Promise.resolve(honoApp.fetch(request))
      .then(async (fetchResponse: globalThis.Response) => {
        // Set status
        res.status(fetchResponse.status)

        // Copy headers
        fetchResponse.headers.forEach((value: string, key: string) => {
          res.setHeader(key, value)
        })

        // Send body
        if (fetchResponse.body) {
          const reader = fetchResponse.body.getReader()

          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              break
            }
            res.write(value)
          }
          res.end()
        }
        else {
          res.end()
        }
      })
      .catch(next)
  })
}
