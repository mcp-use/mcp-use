/**
 * MCP Endpoint Mounting
 *
 * Main orchestration function for mounting MCP endpoints at /mcp and /sse.
 * Uses a single native SDK transport instance to handle all sessions.
 */

import type { Context, Hono as HonoType } from "hono";
import type { SessionData } from "../sessions/index.js";
import { startIdleCleanup } from "../sessions/index.js";
import type { ServerConfig } from "../types/index.js";
import { generateUUID } from "../utils/runtime.js";
import { Telemetry } from "../../telemetry/index.js";

/**
 * Mount MCP server endpoints at /mcp and /sse
 *
 * Uses FetchStreamableHTTPServerTransport (Web Standard APIs) for proper bidirectional communication.
 * Follows the official Hono example from PR #1209.
 */
export async function mountMcp(
  app: HonoType,
  mcpServerInstance: {
    getServerForSession: () => import("@mcp-use/modelcontextprotocol-sdk/server/mcp.js").McpServer;
    cleanupSessionSubscriptions?: (sessionId: string) => void;
  }, // The McpServer instance with getServerForSession() method
  sessions: Map<string, SessionData>,
  config: ServerConfig,
  isProductionMode: boolean
): Promise<{ mcpMounted: boolean; idleCleanupInterval?: NodeJS.Timeout }> {
  const { FetchStreamableHTTPServerTransport } =
    await import("@mcp-use/modelcontextprotocol-sdk/experimental/fetch-streamable-http/index.js");

  const idleTimeoutMs = config.sessionIdleTimeoutMs ?? 300000; // Default: 5 minutes

  // Map to store transports by session ID (following official Hono example from PR #1209)
  const transports = new Map<string, any>();

  // Start idle cleanup interval if configured (only in stateful mode)
  let idleCleanupInterval: NodeJS.Timeout | undefined;
  if (!config.stateless && idleTimeoutMs > 0) {
    idleCleanupInterval = startIdleCleanup(
      sessions,
      idleTimeoutMs,
      transports,
      mcpServerInstance
    );
  }

  // Universal request handler - using Web Standard APIs (no Express adapters needed!)
  const handleRequest = async (c: Context) => {
    if (config.stateless) {
      // STATELESS MODE: New server instance per request (Deno default)
      const server = mcpServerInstance.getServerForSession();
      const transport = new FetchStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // No session tracking
      });

      try {
        await server.connect(transport);
        return await transport.handleRequest(c.req.raw);
      } catch (error) {
        console.error("[MCP] Stateless request error:", error);
        transport.close();
        server.close();
        throw error;
      }
    } else {
      // STATEFUL MODE: Session management (Node.js default)
      const sessionId = c.req.header("mcp-session-id");

      // Handle HEAD requests for keep-alive/health checks
      if (c.req.method === "HEAD") {
        if (sessionId && sessions.has(sessionId)) {
          sessions.get(sessionId)!.lastAccessedAt = Date.now();
        }
        return new Response(null, { status: 200 });
      }

      if (sessionId && transports.has(sessionId)) {
        // Reuse existing transport for this session
        const transport = transports.get(sessionId)!;

        // Update session metadata
        if (sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          session.lastAccessedAt = Date.now();
          session.context = c;
          session.honoContext = c;
        }

        // Pass Web Standard Request directly - no adapter needed!
        return transport.handleRequest(c.req.raw);
      }

      // For new sessions or initialization, create new transport and server
      const server = mcpServerInstance.getServerForSession();
      const transport = new FetchStreamableHTTPServerTransport({
        sessionIdGenerator: () => generateUUID(),

        onsessioninitialized: (sid: string) => {
          console.log(`[MCP] Session initialized: ${sid}`);
          transports.set(sid, transport);
          sessions.set(sid, {
            transport,
            server,
            lastAccessedAt: Date.now(),
            context: c,
            honoContext: c,
          });

          // Capture client capabilities after initialization completes
          // The server.oninitialized callback fires after the client sends the initialized notification
          server.server.oninitialized = () => {
            const clientCapabilities = server.server.getClientCapabilities();
            const clientInfo = (server.server as any).getClientInfo?.() || {};
            const protocolVersion =
              (server.server as any).getProtocolVersion?.() || "unknown";

            if (clientCapabilities && sessions.has(sid)) {
              const session = sessions.get(sid)!;
              session.clientCapabilities = clientCapabilities;
              console.log(
                `[MCP] Captured client capabilities for session ${sid}:`,
                Object.keys(clientCapabilities)
              );
            }

            // Track server initialize event
            Telemetry.getInstance()
              .trackServerInitialize({
                protocolVersion: String(protocolVersion),
                clientInfo: clientInfo || {},
                clientCapabilities: clientCapabilities || {},
                sessionId: sid,
              })
              .catch((e) =>
                console.debug(`Failed to track server initialize: ${e}`)
              );
          };
        },

        onsessionclosed: (sid: string) => {
          console.log(`[MCP] Session closed: ${sid}`);
          transports.delete(sid);
          sessions.delete(sid);
          // Clean up resource subscriptions for this session
          mcpServerInstance.cleanupSessionSubscriptions?.(sid);
        },
      });

      // Connect server to transport
      await server.connect(transport);

      // Pass Web Standard Request directly - no adapter needed!
      return transport.handleRequest(c.req.raw);
    }
  };

  // Mount the handler for all HTTP methods on both /mcp and /sse
  for (const endpoint of ["/mcp", "/sse"]) {
    app.on(["GET", "POST", "DELETE", "HEAD"], endpoint, handleRequest);
  }

  console.log(
    `[MCP] Server mounted at /mcp and /sse (${config.stateless ? "stateless" : "stateful"} mode)`
  );

  return { mcpMounted: true, idleCleanupInterval };
}
