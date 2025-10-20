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

// In-memory storage for widget data (TTL: 1 hour)
interface WidgetData {
  serverId: string
  uri: string
  toolInput: Record<string, any>
  toolOutput: any
  resourceData: any
  toolId: string
  timestamp: number
}

const widgetDataStore = new Map<string, WidgetData>()

// Cleanup expired widget data every 5 minutes
setInterval(
  () => {
    const now = Date.now()
    const ONE_HOUR = 60 * 60 * 1000
    for (const [toolId, data] of widgetDataStore.entries()) {
      if (now - data.timestamp > ONE_HOUR) {
        widgetDataStore.delete(toolId)
      }
    }
  },
  5 * 60 * 1000,
).unref()

/**
 * Register inspector-specific routes (proxy, chat, config, widget rendering)
 */
export function registerInspectorRoutes(app: Hono, config?: { autoConnectUrl?: string | null, mcpInspector?: MCPInspector }) {
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

  // Widget storage endpoint - store widget data for rendering
  app.post('/inspector/api/resources/widget/store', async (c) => {
    try {
      const body = await c.req.json()
      const { serverId, uri, toolInput, toolOutput, resourceData, toolId } = body

      console.log('[Widget Store] Received request for toolId:', toolId)
      console.log('[Widget Store] Fields:', { serverId, uri, hasResourceData: !!resourceData, hasToolInput: !!toolInput, hasToolOutput: !!toolOutput })

      if (!serverId || !uri || !toolId || !resourceData) {
        const missingFields = []
        if (!serverId)
          missingFields.push('serverId')
        if (!uri)
          missingFields.push('uri')
        if (!toolId)
          missingFields.push('toolId')
        if (!resourceData)
          missingFields.push('resourceData')

        console.error('[Widget Store] Missing required fields:', missingFields)
        return c.json({ success: false, error: `Missing required fields: ${missingFields.join(', ')}` }, 400)
      }

      // Store widget data using toolId as key
      widgetDataStore.set(toolId, {
        serverId,
        uri,
        toolInput,
        toolOutput,
        resourceData,
        toolId,
        timestamp: Date.now(),
      })

      console.log('[Widget Store] Data stored successfully for toolId:', toolId)
      return c.json({ success: true })
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
    const widgetData = widgetDataStore.get(toolId)
    if (!widgetData) {
      return c.html(
        '<html><body>Error: Widget data not found or expired</body></html>',
        404,
      )
    }

    // Return a container page that will fetch and load the actual widget
    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Loading Widget...</title>
      </head>
      <body>
        <script>
          (async function() {
            try {
              // Change URL to "/" BEFORE loading widget (for React Router)
              history.replaceState(null, '', '/');

              // Fetch the actual widget HTML using toolId
              const response = await fetch('/inspector/api/resources/widget-content/${toolId}');
              const html = await response.text();

              // Replace entire document with widget HTML using proper method
              document.open();
              // Write the HTML content - the browser will parse it properly
              document.write(html);
              document.close();
            } catch (error) {
              console.error('Failed to load widget:', error);
              document.body.innerHTML = '<div style="padding: 20px; color: red;">Failed to load widget: ' + error.message + '</div>';
            }
          })();
        </script>
      </body>
      </html>
    `)
  })

  // Widget content endpoint - serves pre-fetched resource with injected OpenAI API
  app.get('/inspector/api/resources/widget-content/:toolId', async (c) => {
    try {
      const toolId = c.req.param('toolId')
      console.log('[Widget Content] Serving widget for toolId:', toolId)

      // Retrieve widget data from storage
      const widgetData = widgetDataStore.get(toolId)
      if (!widgetData) {
        console.error('[Widget Content] Widget data not found for toolId:', toolId)
        return c.html(
          '<html><body>Error: Widget data not found or expired</body></html>',
          404,
        )
      }

      const { serverId, uri, toolInput, toolOutput, resourceData } = widgetData
      console.log('[Widget Content] Using pre-fetched resource for:', { serverId, uri })

      // Extract HTML content from the pre-fetched resource data
      let htmlContent = ''

      // The resourceData was fetched client-side, extract HTML from it
      const contentsArray = Array.isArray(resourceData?.contents)
        ? resourceData.contents
        : []

      const firstContent = contentsArray[0]
      if (firstContent) {
        if (typeof (firstContent as { text?: unknown }).text === 'string') {
          htmlContent = (firstContent as { text: string }).text
        }
        else if (
          typeof (firstContent as { blob?: unknown }).blob === 'string'
        ) {
          htmlContent = (firstContent as { blob: string }).blob
        }
      }

      if (!htmlContent && resourceData && typeof resourceData === 'object') {
        const recordContent = resourceData as Record<string, unknown>
        if (typeof recordContent.text === 'string') {
          htmlContent = recordContent.text
        }
        else if (typeof recordContent.blob === 'string') {
          htmlContent = recordContent.blob
        }
      }

      if (!htmlContent) {
        return c.html(
          '<html><body>Error: No HTML content found</body></html>',
          404,
        )
      }

      const widgetStateKey = `openai-widget-state:${toolId}`

      // Safely serialize data to avoid script injection issues
      const safeToolInput = JSON.stringify(toolInput).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
      const safeToolOutput = JSON.stringify(toolOutput).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
      const safeToolId = JSON.stringify(toolId)
      const safeWidgetStateKey = JSON.stringify(widgetStateKey)

      // Inject window.openai API script
      const apiScript = `
        <script>
          (function() {
            'use strict';
            
            // Change URL to "/" for React Router compatibility
            if (window.location.pathname !== '/') {
              history.replaceState(null, '', '/');
            }

            const openaiAPI = {
              toolInput: ${safeToolInput},
              toolOutput: ${safeToolOutput},
              displayMode: 'inline',
              maxHeight: 600,
              theme: 'dark',
              locale: 'en-US',
              safeArea: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
              userAgent: {},
              widgetState: null,

              async setWidgetState(state) {
                this.widgetState = state;
                try {
                  localStorage.setItem(${safeWidgetStateKey}, JSON.stringify(state));
                } catch (err) {
                  console.error('[OpenAI Widget] Failed to save widget state:', err);
                }
                window.parent.postMessage({
                  type: 'openai:setWidgetState',
                  toolId: ${safeToolId},
                  state
                }, '*');
              },

              async callTool(toolName, params = {}) {
                return new Promise((resolve, reject) => {
                  const requestId = \`tool_\${Date.now()}_\${Math.random()}\`;
                  const handler = (event) => {
                    if (event.data.type === 'openai:callTool:response' &&
                        event.data.requestId === requestId) {
                      window.removeEventListener('message', handler);
                      if (event.data.error) {
                        reject(new Error(event.data.error));
                      } else {
                        resolve(event.data.result);
                      }
                    }
                  };
                  window.addEventListener('message', handler);
                  window.parent.postMessage({
                    type: 'openai:callTool',
                    requestId,
                    toolName,
                    params
                  }, '*');
                  setTimeout(() => {
                    window.removeEventListener('message', handler);
                    reject(new Error('Tool call timeout'));
                  }, 30000);
                });
              },

              async sendFollowupTurn(message) {
                const payload = typeof message === 'string'
                  ? { prompt: message }
                  : message;
                window.parent.postMessage({
                  type: 'openai:sendFollowup',
                  message: payload.prompt || payload
                }, '*');
              },

              async requestDisplayMode(options = {}) {
                const mode = options.mode || 'inline';
                this.displayMode = mode;
                window.parent.postMessage({
                  type: 'openai:requestDisplayMode',
                  mode
                }, '*');
                return { mode };
              },

              async sendFollowUpMessage(args) {
                const prompt = typeof args === 'string' ? args : (args?.prompt || '');
                return this.sendFollowupTurn(prompt);
              }
            };

            Object.defineProperty(window, 'openai', {
              value: openaiAPI,
              writable: false,
              configurable: false,
              enumerable: true
            });

            Object.defineProperty(window, 'webplus', {
              value: openaiAPI,
              writable: false,
              configurable: false,
              enumerable: true
            });

            setTimeout(() => {
              try {
                const globalsEvent = new CustomEvent('webplus:set_globals', {
                  detail: {
                    globals: {
                      displayMode: openaiAPI.displayMode,
                      maxHeight: openaiAPI.maxHeight,
                      theme: openaiAPI.theme,
                      locale: openaiAPI.locale,
                      safeArea: openaiAPI.safeArea,
                      userAgent: openaiAPI.userAgent
                    }
                  }
                });
                window.dispatchEvent(globalsEvent);
              } catch (err) {}
            }, 0);

            setTimeout(() => {
              try {
                const stored = localStorage.getItem(${safeWidgetStateKey});
                if (stored && window.openai) {
                  window.openai.widgetState = JSON.parse(stored);
                }
              } catch (err) {}
            }, 0);
          })();
        </script>
      `

      // Inject script into HTML
      let modifiedHtml
      if (htmlContent.includes('<html>') && htmlContent.includes('<head>')) {
        // If it's a full HTML document, inject at the beginning of head
        modifiedHtml = htmlContent.replace(
          '<head>',
          `<head><base href="/">${apiScript}`,
        )
      }
      else {
        // Widget HTML is just fragments, wrap it properly
        modifiedHtml = `<!DOCTYPE html>
<html>
<head>
  <base href="/">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${apiScript}
  <title>Widget</title>
</head>
<body>
  ${htmlContent}
</body>
</html>`
      }

      console.log('[Widget Content] Generated HTML length:', modifiedHtml.length)

      // Set security headers
      const trustedCdns = [
        'https://persistent.oaistatic.com',
        'https://*.oaistatic.com',
        'https://unpkg.com',
        'https://cdn.jsdelivr.net',
        'https://cdnjs.cloudflare.com',
        'https://cdn.skypack.dev',
      ].join(' ')

      c.header(
        'Content-Security-Policy',
        [
          'default-src \'self\'',
          `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${trustedCdns}`,
          'worker-src \'self\' blob:',
          'child-src \'self\' blob:',
          `style-src 'self' 'unsafe-inline' ${trustedCdns}`,
          'img-src \'self\' data: https: blob:',
          'media-src \'self\' data: https: blob:',
          `font-src 'self' data: ${trustedCdns}`,
          'connect-src \'self\' https: wss: ws:',
          'frame-ancestors \'self\'',
        ].join('; '),
      )
      c.header('X-Frame-Options', 'SAMEORIGIN')
      c.header('X-Content-Type-Options', 'nosniff')

      // Disable caching for widget content
      c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
      c.header('Pragma', 'no-cache')
      c.header('Expires', '0')

      return c.html(modifiedHtml)
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
