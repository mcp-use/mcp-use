/**
 * MCP Endpoint Mounting
 *
 * Main orchestration function for mounting MCP endpoints at /mcp and /sse.
 * Uses a single native SDK transport instance to handle all sessions.
 */

import type { Context, Hono as HonoType } from "hono";
import type { SessionData } from "../sessions/index.js";
import {
  startIdleCleanup,
  InMemorySessionStore,
  InMemoryStreamManager,
} from "../sessions/index.js";
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

  // Initialize session store (pluggable - can be Redis, Postgres, etc.)
  // Stores ONLY serializable metadata (client capabilities, log level, timestamps)
  const sessionStore = config.sessionStore ?? new InMemorySessionStore();

  // Initialize stream manager (pluggable - can be Redis Pub/Sub, Postgres NOTIFY, etc.)
  // Manages active SSE connections for notifications, sampling, resource subscriptions
  const streamManager = config.streamManager ?? new InMemoryStreamManager();

  // Map to store transports by session ID (following official Hono example from PR #1209)
  const transports = new Map<string, any>();

  // Warn if deprecated option is used
  if (config.autoCreateSessionOnInvalidId !== undefined) {
    console.warn(
      "[MCP] WARNING: 'autoCreateSessionOnInvalidId' is deprecated and will be removed in a future version.\n" +
        "The MCP specification requires clients to send a new InitializeRequest when receiving a 404 for stale sessions.\n" +
        "Modern MCP clients handle this correctly. For session persistence across restarts, use the 'sessionStore' option.\n" +
        "See: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management"
    );
  }

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
    // Auto-detect mode based on Accept header
    // Per MCP spec: clients that support SSE will send Accept: text/event-stream
    // Clients that don't (k6, curl, etc.) should work in stateless mode
    const acceptHeader = c.req.header("Accept") || c.req.header("accept") || "";
    const clientSupportsSSE = acceptHeader.includes("text/event-stream");

    // Use stateless mode if:
    // 1. Explicitly configured as stateless, OR
    // 2. Client doesn't support SSE (no text/event-stream in Accept header)
    const useStatelessMode = config.stateless || !clientSupportsSSE;

    if (useStatelessMode) {
      // STATELESS MODE: New server instance per request
      // Used for: Deno/edge runtimes, k6 load testing, curl, clients without SSE
      const server = mcpServerInstance.getServerForSession();
      const transport = new FetchStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // No session tracking
        // Enable plain JSON responses ONLY if client doesn't support SSE
        // This allows k6/curl to work while maintaining SSE format for compatible clients
        enableJsonResponse: !clientSupportsSSE,
      });

      try {
        await server.connect(transport);

        // If client doesn't support SSE, add the Accept header to bypass SDK validation
        // The transport requires Accept: text/event-stream even when using enableJsonResponse
        const request = c.req.raw;
        if (!clientSupportsSSE) {
          // Clone request with modified headers
          // Note: duplex is a Node.js-specific extension, cast to any to avoid TypeScript error
          const modifiedRequest = new Request(request.url, {
            method: request.method,
            headers: {
              ...Object.fromEntries(request.headers.entries()),
              Accept: "application/json, text/event-stream",
            },
            body: request.body,
            ...(request.body && ({ duplex: "half" } as any)),
          });
          return await transport.handleRequest(modifiedRequest);
        }

        return await transport.handleRequest(request);
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
        if (sessionId && (await sessionStore.has(sessionId))) {
          const session = await sessionStore.get(sessionId);
          if (session) {
            session.lastAccessedAt = Date.now();
            await sessionStore.set(sessionId, session);
          }
        }
        return new Response(null, { status: 200 });
      }

      // Check if session ID exists but transport doesn't (stale session after restart)
      if (sessionId && !(await sessionStore.has(sessionId))) {
        // Per MCP spec: Return 404 for invalid/expired sessions
        // Client MUST send new InitializeRequest to establish new session
        // See: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management
        console.log(
          `[MCP] Session not found: ${sessionId} - returning 404 (client should re-initialize)`
        );
        return c.json(
          {
            jsonrpc: "2.0",
            error: { code: -32001, message: "Session not found" },
            id: null,
          },
          404
        );
      }

      if (sessionId && transports.has(sessionId)) {
        // Reuse existing transport for this session
        const transport = transports.get(sessionId)!;

        // Update session metadata (only serializable fields)
        const metadata = await sessionStore.get(sessionId);
        if (metadata) {
          metadata.lastAccessedAt = Date.now();
          await sessionStore.set(sessionId, metadata);
        }

        // Update in-memory session data with current context
        const sessionData = sessions.get(sessionId);
        if (sessionData) {
          sessionData.lastAccessedAt = Date.now();
          sessionData.context = c;
          sessionData.honoContext = c;
        }

        // Pass Web Standard Request directly - no adapter needed!
        return transport.handleRequest(c.req.raw);
      }

      // For new sessions or initialization, create new transport and server
      const server = mcpServerInstance.getServerForSession();
      const transport = new FetchStreamableHTTPServerTransport({
        sessionIdGenerator: () => generateUUID(),

        onsessioninitialized: async (sid: string) => {
          console.log(`[MCP] Session initialized: ${sid}`);
          transports.set(sid, transport);

          // Store full session data in memory (includes transport, server, context)
          const sessionData: SessionData = {
            transport,
            server,
            lastAccessedAt: Date.now(),
            context: c,
            honoContext: c,
          };
          sessions.set(sid, sessionData);

          // Store only serializable metadata in sessionStore
          await sessionStore.set(sid, {
            lastAccessedAt: Date.now(),
          });

          // Capture client capabilities after initialization completes
          // The server.oninitialized callback fires after the client sends the initialized notification
          server.server.oninitialized = async () => {
            const clientCapabilities = server.server.getClientCapabilities();
            const clientInfo = (server.server as any).getClientInfo?.() || {};
            const protocolVersion =
              (server.server as any).getProtocolVersion?.() || "unknown";

            // Update metadata in sessionStore
            const metadata = await sessionStore.get(sid);
            if (metadata) {
              metadata.clientCapabilities = clientCapabilities;
              metadata.clientInfo = clientInfo;
              metadata.protocolVersion = String(protocolVersion);
              await sessionStore.set(sid, metadata);

              console.log(
                `[MCP] Captured client capabilities for session ${sid}:`,
                clientCapabilities ? Object.keys(clientCapabilities) : "none"
              );
            }

            // Update in-memory session data
            const sessionData = sessions.get(sid);
            if (sessionData) {
              sessionData.clientCapabilities = clientCapabilities;
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

        onsessionclosed: async (sid: string) => {
          console.log(`[MCP] Session closed: ${sid}`);
          transports.delete(sid);

          // Clean up stream manager
          await streamManager.delete(sid);

          // Clean up session metadata
          await sessionStore.delete(sid);
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
