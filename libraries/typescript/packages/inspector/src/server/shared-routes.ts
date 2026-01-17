import type { Hono } from "hono";
import { mountMcpProxy, mountOAuthProxy } from "mcp-use/server";
import { rpcLogBus, type RpcLogEvent } from "./rpc-log-bus.js";
import {
  generateWidgetContainerHtml,
  generateWidgetContentHtml,
  getWidgetData,
  getWidgetSecurityHeaders,
  handleChatRequest,
  handleChatRequestStream,
  storeWidgetData,
} from "./shared-utils-browser.js";
import { formatErrorResponse } from "./utils.js";

// WebSocket proxy for Vite HMR - note: requires WebSocket library
// For now, this is a placeholder that will be implemented when WebSocket support is added

/**
 * Register inspector-specific routes (proxy, chat, config, widget rendering)
 */
export function registerInspectorRoutes(
  app: Hono,
  config?: { autoConnectUrl?: string | null }
) {
  app.get("/inspector/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Mount MCP proxy middleware at the inspector's proxy path
  mountMcpProxy(app, {
    path: "/inspector/api/proxy",
  });

  // Mount OAuth proxy middleware at the inspector's OAuth path
  mountOAuthProxy(app, {
    basePath: "/inspector/api/oauth",
    enableLogging: true,
  });

  // Chat API endpoint - handles MCP agent chat with custom LLM key (streaming)
  app.post("/inspector/api/chat/stream", async (c) => {
    try {
      const requestBody = await c.req.json();

      // Create a readable stream from the async generator
      const { readable, writable } = new globalThis.TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Start streaming in the background
      (async () => {
        try {
          for await (const chunk of handleChatRequestStream(requestBody)) {
            await writer.write(encoder.encode(chunk));
          }
        } catch (error) {
          const errorMsg = `${JSON.stringify({
            type: "error",
            data: {
              message: error instanceof Error ? error.message : "Unknown error",
            },
          })}\n`;
          await writer.write(encoder.encode(errorMsg));
        } finally {
          await writer.close();
        }
      })();

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (error) {
      return c.json(formatErrorResponse(error, "handleChatRequestStream"), 500);
    }
  });

  // Chat API endpoint - handles MCP agent chat with custom LLM key (non-streaming)
  app.post("/inspector/api/chat", async (c) => {
    try {
      const requestBody = await c.req.json();
      const result = await handleChatRequest(requestBody);
      return c.json(result);
    } catch (error) {
      return c.json(formatErrorResponse(error, "handleChatRequest"), 500);
    }
  });

  // Widget storage endpoint - store widget data for rendering
  app.post("/inspector/api/resources/widget/store", async (c) => {
    try {
      const body = await c.req.json();
      const result = storeWidgetData(body);

      if (!result.success) {
        return c.json(result, 400);
      }

      return c.json(result);
    } catch (error) {
      console.error("[Widget Store] Error:", error);
      console.error(
        "[Widget Store] Stack:",
        error instanceof Error ? error.stack : ""
      );
      return c.json(formatErrorResponse(error, "storeWidgetData"), 500);
    }
  });

  // Widget container endpoint - serves container page that loads widget
  app.get("/inspector/api/resources/widget/:toolId", async (c) => {
    const toolId = c.req.param("toolId");

    // Check if data exists in storage
    const widgetData = getWidgetData(toolId);
    if (!widgetData) {
      return c.html(
        "<html><body>Error: Widget data not found or expired</body></html>",
        404
      );
    }

    // Return a container page that will fetch and load the actual widget
    return c.html(generateWidgetContainerHtml("/inspector", toolId));
  });

  // Widget content endpoint - serves pre-fetched resource with injected OpenAI API
  app.get("/inspector/api/resources/widget-content/:toolId", async (c) => {
    try {
      const toolId = c.req.param("toolId");

      // Retrieve widget data from storage
      const widgetData = getWidgetData(toolId);
      if (!widgetData) {
        console.error(
          "[Widget Content] Widget data not found for toolId:",
          toolId
        );
        return c.html(
          "<html><body>Error: Widget data not found or expired</body></html>",
          404
        );
      }

      // Generate the widget HTML using shared function
      const result = generateWidgetContentHtml(widgetData);

      if (result.error) {
        return c.html(`<html><body>Error: ${result.error}</body></html>`, 404);
      }

      // Set security headers with widget-specific CSP
      const headers = getWidgetSecurityHeaders(widgetData.widgetCSP);
      Object.entries(headers).forEach(([key, value]) => {
        c.header(key, value);
      });

      return c.html(result.html);
    } catch (error) {
      console.error("[Widget Content] Error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : "";
      console.error("[Widget Content] Stack:", errorStack);
      return c.html(`<html><body>Error: ${errorMessage}</body></html>`, 500);
    }
  });

  // Dev widget HTML proxy - fetches from dev server and injects OpenAI wrapper
  app.get("/inspector/api/dev-widget/:toolId", async (c) => {
    try {
      const toolId = c.req.param("toolId");
      const widgetData = getWidgetData(toolId);

      if (!widgetData?.devWidgetUrl || !widgetData?.devServerBaseUrl) {
        return c.html(
          "<html><body>Error: Dev widget data not found or expired</body></html>",
          404
        );
      }

      // Fetch HTML from dev server
      const response = await fetch(widgetData.devWidgetUrl, {
        signal: AbortSignal.timeout(60000), // 60 second timeout for Vite cold start
      });
      if (!response.ok) {
        const status = response.status as 400 | 404 | 500 | 502 | 503;
        return c.html(
          `<html><body>Error: Failed to fetch widget from dev server (${response.status})</body></html>`,
          status
        );
      }

      let html = await response.text();

      // Create a modified widgetData with the fetched HTML as resourceData
      const modifiedWidgetData = {
        ...widgetData,
        resourceData: {
          contents: [{ text: html }],
        },
      };

      // Inject OpenAI wrapper using existing logic
      const result = generateWidgetContentHtml(modifiedWidgetData);

      if (result.error) {
        return c.html(`<html><body>Error: ${result.error}</body></html>`, 500);
      }

      // Use the HTML with injected wrapper for path rewriting
      html = result.html;

      // Rewrite asset paths to go through proxy
      const proxyBase = `/inspector/api/dev-widget/${toolId}/assets`;

      // Extract widget name from devWidgetUrl if available
      const widgetNameMatch = widgetData.devWidgetUrl?.match(
        /\/mcp-use\/widgets\/([^/?]+)/
      );
      const widgetName = widgetNameMatch ? widgetNameMatch[1] : "widget";

      // Replace absolute paths to dev server with proxy paths
      const escapedBaseUrl = widgetData.devServerBaseUrl.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
      html = html.replace(
        new RegExp(
          `(src|href)="(${escapedBaseUrl}/mcp-use/widgets/[^"]+)"`,
          "g"
        ),
        (_match, attr, url) => {
          // Extract the path after the base URL
          const path = url.replace(widgetData.devServerBaseUrl, "");
          return `${attr}="${proxyBase}${path}"`;
        }
      );

      // Also handle relative paths that start with /mcp-use/widgets/
      // In dev mode, load all assets directly from dev server for simplicity
      // This avoids issues with dynamically loaded assets that bypass HTML rewriting
      html = html.replace(
        /(src|href)="(\/mcp-use\/widgets\/[^"]+)"/g,
        (_match, attr, path) => {
          // Rewrite to absolute URL pointing to dev server
          return `${attr}="${widgetData.devServerBaseUrl}${path}"`;
        }
      );

      // Handle Vite's asset imports (e.g., import.meta.url, __VITE_ASSET__)
      // These are typically handled by Vite's dev server, but we rewrite base paths
      html = html.replace(/(src|href)="\.\/([^"]+)"/g, (match, attr, path) => {
        // Only rewrite if it's in a script context or if it looks like an asset
        if (
          path.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/i)
        ) {
          return `${attr}="${proxyBase}/mcp-use/widgets/${widgetName}/${path}"`;
        }
        return match;
      });

      // Inject base tag and Vite HMR WebSocket configuration
      if (widgetData.devServerBaseUrl) {
        const devServerUrl = new URL(widgetData.devServerBaseUrl);
        const wsProtocol = devServerUrl.protocol === "https:" ? "wss" : "ws";
        const wsHost = devServerUrl.host; // e.g., "localhost:3004"

        // Point directly to Vite HMR endpoint on the dev server
        const directWsUrl = `${wsProtocol}://${wsHost}/mcp-use/widgets/`;

        // Inject base tag to make all relative URLs resolve against dev server
        // This is critical for Vite's dynamic module loading
        // MUST be injected right after <head> tag, before any scripts
        const baseTag = `<base href="${widgetData.devServerBaseUrl}/mcp-use/widgets/${widgetName}/">`;

        // Inject CSP violation listener to warn about non-whitelisted resources
        const cspWarningScript = `
    <script>
      // Listen for CSP violations (from Report-Only policy)
      document.addEventListener('securitypolicyviolation', (e) => {
        // Only warn about report-only violations (not enforced ones)
        if (e.disposition === 'report') {
          console.warn(
            '%c⚠️ CSP Warning: Resource would be blocked in production',
            'color: orange; font-weight: bold',
            '\\n  Blocked URL:', e.blockedURI,
            '\\n  Directive:', e.violatedDirective,
            '\\n  Policy:', e.originalPolicy,
            '\\n\\nℹ️ To fix: Add this domain to your widget\\'s CSP configuration in appsSdkMetadata[\\'openai/widgetCSP\\']'
          );
        }
      });
    </script>`;

        // Inject configuration script before Vite client loads
        // This tells Vite where to connect for HMR
        const viteConfigScript = `
    <script>
      // Configure Vite HMR to connect directly to dev server
      window.__vite_ws_url__ = "${directWsUrl}";
    </script>`;

        // Insert base tag immediately after <head> (before any scripts)
        html = html.replace(/<head>/i, `<head>\n    ${baseTag}`);

        // Insert CSP warning and config scripts before the first script tag
        html = html.replace(
          /<script/,
          cspWarningScript + viteConfigScript + "\n    <script"
        );
      }

      // Set security headers
      const headers = getWidgetSecurityHeaders(
        widgetData.widgetCSP,
        widgetData.devServerBaseUrl
      );
      Object.entries(headers).forEach(([key, value]) => {
        c.header(key, value);
      });

      return c.html(html);
    } catch (error) {
      console.error("[Dev Widget Proxy] Error:", error);

      // Check if this is a timeout error
      const isTimeout =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");

      if (isTimeout) {
        return c.html(
          `<html><body>Error: Request timed out while fetching widget from dev server. ` +
            `This may happen during Vite cold start. Please try again.</body></html>`,
          504
        );
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return c.html(`<html><body>Error: ${errorMessage}</body></html>`, 500);
    }
  });

  // Dev widget asset proxy - forwards asset requests to dev server
  app.get("/inspector/api/dev-widget/:toolId/assets/*", async (c) => {
    try {
      const toolId = c.req.param("toolId");
      const assetPath = c.req.path.replace(
        `/inspector/api/dev-widget/${toolId}/assets`,
        ""
      );
      const widgetData = getWidgetData(toolId);

      if (!widgetData?.devServerBaseUrl) {
        return c.notFound();
      }

      // Construct full URL to dev server asset
      const devAssetUrl = `${widgetData.devServerBaseUrl}${assetPath}`;

      // Forward request to dev server
      const response = await fetch(devAssetUrl, {
        signal: AbortSignal.timeout(30000), // 30 second timeout for assets
        headers: {
          Accept: c.req.header("Accept") || "*/*",
        },
      });

      if (!response.ok) {
        return c.notFound();
      }

      // Forward response with appropriate headers
      const contentType =
        response.headers.get("Content-Type") || "application/octet-stream";
      const headers: Record<string, string> = {
        "Content-Type": contentType,
      };

      // Forward cache headers if present
      const cacheControl = response.headers.get("Cache-Control");
      if (cacheControl) {
        headers["Cache-Control"] = cacheControl;
      }

      return new Response(response.body, {
        status: response.status,
        headers,
      });
    } catch (error) {
      // Check if this is a timeout error
      const isTimeout =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");

      if (isTimeout) {
        console.error("[Dev Widget Asset Proxy] Request timed out:", error);
      } else {
        console.error("[Dev Widget Asset Proxy] Error:", error);
      }

      return c.notFound();
    }
  });

  // Inspector config endpoint
  app.get("/inspector/config.json", (c) => {
    return c.json({
      autoConnectUrl: config?.autoConnectUrl || null,
    });
  });

  // Telemetry proxy endpoint - forwards telemetry events to PostHog from server-side
  app.post("/inspector/api/tel/posthog", async (c) => {
    try {
      const body = await c.req.json();
      const { event, user_id, properties } = body;

      if (!event) {
        return c.json({ success: false, error: "Missing event name" }, 400);
      }

      // Initialize PostHog lazily (only when needed)
      const { PostHog } = await import("posthog-node");
      const posthog = new PostHog(
        "phc_lyTtbYwvkdSbrcMQNPiKiiRWrrM1seyKIMjycSvItEI",
        {
          host: "https://eu.i.posthog.com",
        }
      );

      // Use the user_id from the request, or fallback to 'anonymous'
      const distinctId = user_id || "anonymous";

      // Capture the event
      posthog.capture({
        distinctId,
        event,
        properties: properties || {},
      });

      // Flush to ensure event is sent
      await posthog.shutdown();

      return c.json({ success: true });
    } catch (error) {
      console.error("[Telemetry] Error forwarding to PostHog:", error);
      // Don't fail - telemetry should be silent
      return c.json({ success: false });
    }
  });

  // Telemetry proxy endpoint - forwards telemetry events to Scarf from server-side
  app.post("/inspector/api/tel/scarf", async (c) => {
    try {
      const body = await c.req.json();

      // Forward to Scarf gateway from server (no CORS issues)
      const response = await fetch(
        "https://mcpuse.gateway.scarf.sh/events-inspector",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        console.error("[Telemetry] Scarf request failed:", response.status);

        return c.json({
          success: false,
          status: response.status,
          error: response.statusText,
        });
      }

      return c.json({ success: true });
    } catch (error) {
      console.error("[Telemetry] Error forwarding to Scarf:", error);
      // Don't fail - telemetry should be silent
      return c.json({ success: false });
    }
  });

  // RPC Log endpoint - receives RPC events from browser
  app.post("/inspector/api/rpc/log", async (c) => {
    try {
      const event = (await c.req.json()) as RpcLogEvent;
      rpcLogBus.publish(event);
      return c.json({ success: true });
    } catch (error) {
      console.error("[RPC Log] Error receiving RPC event:", error);
      return c.json({ success: false });
    }
  });

  // Clear RPC log buffer endpoint
  app.delete("/inspector/api/rpc/log", async (c) => {
    try {
      const url = new URL(c.req.url);
      const serverIdsParam = url.searchParams.get("serverIds");
      const serverIds = serverIdsParam
        ? serverIdsParam.split(",").filter(Boolean)
        : undefined;
      rpcLogBus.clear(serverIds);
      return c.json({ success: true });
    } catch (error) {
      console.error("[RPC Log] Error clearing RPC log:", error);
      return c.json({ success: false });
    }
  });

  // RPC Stream endpoint - streams RPC events via SSE
  app.get("/inspector/api/rpc/stream", async (c) => {
    const url = new URL(c.req.url);
    const replay = parseInt(url.searchParams.get("replay") || "3", 10);
    const serverIdsParam = url.searchParams.get("serverIds");
    const serverIds = serverIdsParam
      ? serverIdsParam.split(",").filter(Boolean)
      : [];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (data: unknown) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            );
          } catch {
            // Ignore encoding errors
          }
        };

        // Replay recent messages
        try {
          const recent = rpcLogBus.getBuffer(
            serverIds,
            isNaN(replay) ? 3 : replay
          );
          for (const evt of recent) {
            send({ type: "rpc", ...evt });
          }
        } catch {
          // Ignore replay errors
        }

        // Subscribe to live events
        const unsubscribe = rpcLogBus.subscribe(
          serverIds,
          (evt: RpcLogEvent) => {
            send({ type: "rpc", ...evt });
          }
        );

        // Keepalive comments
        const keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
          } catch {
            // Ignore keepalive errors
          }
        }, 15000);

        // Cleanup on client disconnect
        c.req.raw.signal?.addEventListener("abort", () => {
          try {
            clearInterval(keepalive);
            unsubscribe();
          } catch {
            // Ignore cleanup errors
          }
          try {
            controller.close();
          } catch {
            // Ignore close errors
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "*",
      },
    });
  });
}
