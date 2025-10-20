import type { Hono } from 'hono'
import {
  generateWidgetContainerHtml,
  generateWidgetContentHtml,
  getWidgetData,
  getWidgetSecurityHeaders,
  handleChatRequest,
  handleChatRequestStream,
  storeWidgetData,
} from './shared-utils-browser.js'
import { formatErrorResponse } from './utils.js'

/**
 * Register inspector-specific routes (proxy, chat, config, widget rendering)
 */
export function registerInspectorRoutes(app: Hono, config?: { autoConnectUrl?: string | null }) {
  // MCP Proxy endpoint - proxies MCP requests to target servers
  // WARNING: This proxy endpoint does not implement authentication.
  // For production use, consider adding authentication or restricting access to localhost only.

  app.get('/inspector/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

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

  // Widget storage endpoint - store widget data for rendering
  app.post('/inspector/api/resources/widget/store', async (c) => {
    try {
      const body = await c.req.json()
      const result = storeWidgetData(body)

      if (!result.success) {
        return c.json(result, 400)
      }

      return c.json(result)
    }
    catch (error) {
      console.error('[Widget Store] Error:', error)
      console.error('[Widget Store] Stack:', error instanceof Error ? error.stack : '')
      return c.json(formatErrorResponse(error, 'storeWidgetData'), 500)
    }
  })

  // Widget container endpoint - serves container page that loads widget
  app.get('/inspector/api/resources/widget/:toolId', async (c) => {
    const toolId = c.req.param('toolId')

    // Check if data exists in storage
    const widgetData = getWidgetData(toolId)
    if (!widgetData) {
      return c.html(
        '<html><body>Error: Widget data not found or expired</body></html>',
        404,
      )
    }

    // Return a container page that will fetch and load the actual widget
    return c.html(generateWidgetContainerHtml('/inspector', toolId))
  })

  // Widget content endpoint - serves pre-fetched resource with injected OpenAI API
  app.get('/inspector/api/resources/widget-content/:toolId', async (c) => {
    try {
      const toolId = c.req.param('toolId')

      // Retrieve widget data from storage
      const widgetData = getWidgetData(toolId)
      if (!widgetData) {
        console.error('[Widget Content] Widget data not found for toolId:', toolId)
        return c.html(
          '<html><body>Error: Widget data not found or expired</body></html>',
          404,
        )
      }

      // Generate the widget HTML using shared function
      const result = generateWidgetContentHtml(widgetData)

      if (result.error) {
        return c.html(`<html><body>Error: ${result.error}</body></html>`, 404)
      }

      // Set security headers
      const headers = getWidgetSecurityHeaders()
      Object.entries(headers).forEach(([key, value]) => {
        c.header(key, value)
      })

      return c.html(result.html)
    }
    catch (error) {
      console.error('[Widget Content] Error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const errorStack = error instanceof Error ? error.stack : ''
      console.error('[Widget Content] Stack:', errorStack)
      return c.html(
        `<html><body>Error: ${errorMessage}</body></html>`,
        500,
      )
    }
  })

  // Inspector config endpoint
  app.get('/inspector/config.json', (c) => {
    return c.json({
      autoConnectUrl: config?.autoConnectUrl || null,
    })
  })
}
