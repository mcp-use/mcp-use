import type { Hono } from "hono";
import { mountMcpProxy, mountOAuthProxy } from "mcp-use/server";
import { registerMcpAppsRoutes } from "./routes/mcp-apps.js";
import { rpcLogBus, type RpcLogEvent } from "./rpc-log-bus.js";
import {
  generateWidgetContainerHtml,
  generateWidgetContentHtml,
  getWidgetData,
  getWidgetSecurityHeaders,
  handleChatRequest,
  handleChatRequestStream,
  storeWidgetData,
} from "./shared-utils.js";
import { formatErrorResponse } from "./utils.js";

/**
 * Get frame-ancestors policy from environment variable
 * Format: Space-separated list of origins or '*'
 * Example: MCP_INSPECTOR_FRAME_ANCESTORS="https://app.example.com http://localhost:3000"
 */
function getFrameAncestorsFromEnv(): string | undefined {
  const envValue = process.env.MCP_INSPECTOR_FRAME_ANCESTORS;
  if (!envValue) return undefined;

  // Validate format (either '*' or space-separated origins)
  const trimmed = envValue.trim();
  if (trimmed === "*") return "*";

  // For origin list, keep as-is (CSP expects space-separated)
  return trimmed;
}

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

  // Mount MCP Apps routes at /inspector/api/mcp-apps
  // Note: registerMcpAppsRoutes handles the /inspector/api/mcp-apps prefix internally
  registerMcpAppsRoutes(app);

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

      // Derive the MCP server origin from serverId so widget resources
      // (scripts, images, styles) hosted on the MCP server are allowed by CSP.
      let serverOrigin: string | undefined;
      if (widgetData.serverId && /^https?:\/\//.test(widgetData.serverId)) {
        try {
          serverOrigin = new URL(
            widgetData.serverId.replace(/\/mcp$/, "")
          ).origin.replace("0.0.0.0", "localhost");
        } catch {
          /* ignore invalid URLs */
        }
      }

      const headers = getWidgetSecurityHeaders(
        widgetData.widgetCSP,
        serverOrigin,
        getFrameAncestorsFromEnv()
      );
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

  // Inspector config endpoint
  app.get("/inspector/config.json", (c) => {
    return c.json({
      autoConnectUrl: config?.autoConnectUrl || null,
    });
  });

  // Helper to check if telemetry is disabled via environment
  const isTelemetryDisabled = () =>
    process.env.MCP_USE_ANONYMIZED_TELEMETRY === "false" ||
    process.env.NODE_ENV === "test";

  // Telemetry proxy endpoint - forwards telemetry events to PostHog from server-side
  app.post("/inspector/api/tel/posthog", async (c) => {
    // Skip telemetry in test environments
    if (isTelemetryDisabled()) {
      return c.json({ success: true });
    }

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
    // Skip telemetry in test environments
    if (isTelemetryDisabled()) {
      return c.json({ success: true });
    }

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
