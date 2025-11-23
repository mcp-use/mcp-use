import type { Hono } from "hono";
import { logger } from "hono/logger";
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
  // MCP Proxy endpoint - proxies MCP requests to target servers
  // WARNING: This proxy endpoint does not implement authentication.
  // For production use, consider adding authentication or restricting access to localhost only.

  app.get("/inspector/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Apply logger middleware only to proxy routes
  app.use("/inspector/api/proxy/*", logger());

  app.all("/inspector/api/proxy/*", async (c) => {
    try {
      const targetUrl = c.req.header("X-Target-URL");

      if (!targetUrl) {
        return c.json({ error: "X-Target-URL header is required" }, 400);
      }

      // Forward the request to the target MCP server
      const method = c.req.method;
      const headers: Record<string, string> = {};

      // Copy relevant headers, excluding proxy-specific ones and encoding preferences
      const requestHeaders = c.req.header();
      for (const [key, value] of Object.entries(requestHeaders)) {
        const lowerKey = key.toLowerCase();
        if (
          !lowerKey.startsWith("x-proxy-") &&
          !lowerKey.startsWith("x-target-") &&
          lowerKey !== "host" &&
          lowerKey !== "accept-encoding"
        ) {
          // Don't forward accept-encoding to prevent compression
          headers[key] = value;
        }
      }

      // Explicitly request uncompressed response
      headers["Accept-Encoding"] = "identity";

      // Set the target URL as the host
      try {
        const targetUrlObj = new URL(targetUrl);
        headers.Host = targetUrlObj.host;
      } catch {
        return c.json({ error: "Invalid target URL" }, 400);
      }

      const body =
        method !== "GET" && method !== "HEAD"
          ? await c.req.arrayBuffer()
          : undefined;

      const response = await fetch(targetUrl, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
      });

      // Forward response headers, excluding problematic encoding headers
      // Node.js fetch() auto-decompresses the body but preserves these headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        // Skip compression-related headers that don't match the actual body state
        if (
          lowerKey !== "content-encoding" &&
          lowerKey !== "transfer-encoding" &&
          lowerKey !== "content-length"
        ) {
          responseHeaders[key] = value;
        }
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Proxy request failed:", message, error);
      return c.json({ error: "Proxy request failed", details: message }, 500);
    }
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
      const response = await fetch(widgetData.devWidgetUrl);
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
      // BUT exclude @vite/client and @react-refresh which need direct access for HMR
      html = html.replace(
        /(src|href)="(\/mcp-use\/widgets\/[^"]+)"/g,
        (_match, attr, path) => {
          // Don't proxy Vite's HMR client scripts - they need direct connection
          if (
            path.includes("/@vite/client") ||
            path.includes("/@react-refresh")
          ) {
            // Rewrite to absolute URL pointing to dev server
            return `${attr}="${widgetData.devServerBaseUrl}${path}"`;
          }
          // Proxy other assets
          return `${attr}="${proxyBase}${path}"`;
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

      // Inject Vite HMR WebSocket configuration before @vite/client loads
      if (widgetData.devServerBaseUrl) {
        const devServerUrl = new URL(widgetData.devServerBaseUrl);
        const wsProtocol = devServerUrl.protocol === "https:" ? "wss" : "ws";
        const wsHost = devServerUrl.host; // e.g., "localhost:3000"

        // Point directly to Vite HMR endpoint on the dev server
        const directWsUrl = `${wsProtocol}://${wsHost}/mcp-use/widgets/`;

        // Inject configuration script before Vite client loads
        // This tells Vite where to connect for HMR
        const viteConfigScript = `
    <script>
      // Configure Vite HMR to connect directly to dev server
      window.__vite_ws_url__ = "${directWsUrl}";
    </script>`;

        // Insert before the first script tag (typically @vite/client)
        html = html.replace(/<script/, viteConfigScript + "\n    <script");
      }

      // Set security headers
      const headers = getWidgetSecurityHeaders(widgetData.widgetCSP);
      Object.entries(headers).forEach(([key, value]) => {
        c.header(key, value);
      });

      return c.html(html);
    } catch (error) {
      console.error("[Dev Widget Proxy] Error:", error);
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
      console.error("[Dev Widget Asset Proxy] Error:", error);
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
}
