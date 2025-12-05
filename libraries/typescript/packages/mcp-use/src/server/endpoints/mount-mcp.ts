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

/**
 * Mount MCP server endpoints at /mcp and /sse
 *
 * Uses FetchStreamableHTTPServerTransport (Web Standard APIs) for proper bidirectional communication.
 * Follows the official Hono example from PR #1209.
 */
export async function mountMcp(
  app: HonoType,
  mcpServerInstance: {
    getServerForSession: () => import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
    cleanupSessionSubscriptions?: (sessionId: string) => void;
  }, // The McpServer instance with getServerForSession() method
  sessions: Map<string, SessionData>,
  config: ServerConfig,
  isProductionMode: boolean
): Promise<{ mcpMounted: boolean; idleCleanupInterval?: NodeJS.Timeout }> {
  const { FetchStreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/experimental/fetch-streamable-http/index.js");

  const idleTimeoutMs = config.sessionIdleTimeoutMs ?? 300000; // Default: 5 minutes

  // Map to store transports by session ID (following official Hono example from PR #1209)
  const transports = new Map<string, any>();

  // Start idle cleanup interval if configured
  let idleCleanupInterval: NodeJS.Timeout | undefined;
  if (idleTimeoutMs > 0) {
    idleCleanupInterval = startIdleCleanup(
      sessions,
      idleTimeoutMs,
      mcpServerInstance
    );
  }

  // Universal request handler - using Web Standard APIs (no Express adapters needed!)
  const handleRequest = async (c: Context) => {
    const sessionId = c.req.header("mcp-session-id");

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
          if (clientCapabilities && sessions.has(sid)) {
            const session = sessions.get(sid)!;
            session.clientCapabilities = clientCapabilities;
            console.log(
              `[MCP] Captured client capabilities for session ${sid}:`,
              Object.keys(clientCapabilities)
            );
          }
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
  };

  // Mount the handler for all HTTP methods on both /mcp and /sse
  for (const endpoint of ["/mcp", "/sse"]) {
    app.on(["GET", "POST", "DELETE"], endpoint, handleRequest);
  }

  console.log(
    `[MCP] Server mounted at /mcp and /sse (using FetchStreamableHTTPServerTransport - Web Standard APIs)`
  );

  return { mcpMounted: true, idleCleanupInterval };
}
