/**
 * MCP Endpoint Mounting
 *
 * Main orchestration function for mounting MCP endpoints at /mcp and /sse.
 * Uses a single native SDK transport instance to handle all sessions.
 */

import type { Context, Hono as HonoType } from "hono";
import { join } from "node:path";
import { Telemetry } from "../../telemetry/index.js";
import { runWithContext } from "../context-storage.js";
import { generateLandingPage } from "../landing.js";
import type { SessionData } from "../sessions/index.js";
import {
  FileSystemSessionStore,
  InMemorySessionStore,
  InMemoryStreamManager,
  startIdleCleanup,
} from "../sessions/index.js";
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
    getServerForSession: (
      sessionId?: string
    ) => import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
    cleanupSessionSubscriptions?: (sessionId: string) => void;
    cleanupSessionRefs?: (sessionId: string) => void;
  }, // The McpServer instance with getServerForSession() method
  sessions: Map<string, SessionData>,
  config: ServerConfig,
  isProductionMode: boolean
): Promise<{ mcpMounted: boolean; idleCleanupInterval?: NodeJS.Timeout }> {
  const { WebStandardStreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");

  const idleTimeoutMs = config.sessionIdleTimeoutMs ?? 86400000; // Default: 1 day

  // Initialize session store (pluggable - can be Redis, Postgres, etc.)
  // Stores ONLY serializable metadata (client capabilities, log level, timestamps)
  // In development mode: use FileSystemSessionStore for hot reload support
  // In production mode: use InMemorySessionStore for performance
  const sessionStore =
    config.sessionStore ??
    (isProductionMode
      ? new InMemorySessionStore()
      : new FileSystemSessionStore({
          path: join(process.cwd(), ".mcp-use", "sessions.json"),
        }));

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

  // Helper function to construct the full URL considering proxy headers
  const getFullUrl = (c: Context): string => {
    // Check for proxy headers (common in production deployments)
    const proto =
      c.req.header("X-Forwarded-Proto") ||
      c.req.header("X-Forwarded-Protocol") ||
      new URL(c.req.url).protocol.replace(":", "");

    const host =
      c.req.header("X-Forwarded-Host") ||
      c.req.header("Host") ||
      new URL(c.req.url).host;

    const path = c.req.path;

    return `${proto}://${host}${path}`;
  };

  // Universal request handler - using Web Standard APIs (no Express adapters needed!)
  const handleRequest = async (c: Context) => {
    // Detect browser GET requests and return landing page
    if (c.req.method === "GET") {
      const acceptHeader = c.req.header("Accept") || "";
      const isBrowser =
        acceptHeader.includes("text/html") ||
        (!acceptHeader.includes("application/json") &&
          !acceptHeader.includes("text/event-stream"));

      if (isBrowser) {
        const fullUrl = getFullUrl(c);
        const landingPage = generateLandingPage(
          config.name,
          config.version,
          fullUrl,
          config.description
        );
        return new Response(landingPage, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

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

      // Handle HEAD requests for health checks (no session to maintain)
      if (c.req.method === "HEAD") {
        return new Response(null, { status: 200 });
      }

      const server = mcpServerInstance.getServerForSession();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // No session tracking
        // IMPORTANT: Always use JSON responses in stateless mode
        // Edge runtimes (Deno, Cloudflare Workers, Supabase) cannot maintain long-lived SSE streams
        // Even if client supports SSE, we must use request-response JSON in stateless environments
        enableJsonResponse: true,
      });

      try {
        await server.connect(transport);

        // Wrap in request context so tool/resource callbacks can access headers
        return await runWithContext(c, async () => {
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
        });
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
          // Also update in-memory sessions map for idle cleanup
          const sessionData = sessions.get(sessionId);
          if (sessionData) {
            sessionData.lastAccessedAt = Date.now();
          }
        }
        return new Response(null, { status: 200 });
      }

      // Check if session ID exists in store but not in transports (server restart scenario)
      if (
        sessionId &&
        (await sessionStore.has(sessionId)) &&
        !transports.has(sessionId)
      ) {
        // Session metadata exists but transport was lost (server restart in dev mode)
        // Create a new transport but reuse the existing session ID
        console.log(
          `[MCP] Session metadata found but transport lost (likely hot reload): ${sessionId} - recreating transport`
        );

        const server = mcpServerInstance.getServerForSession(sessionId);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId, // Reuse existing session ID

          onsessioninitialized: async (sid: string) => {
            console.log(`[MCP] Session reconnected: ${sid}`);
            transports.set(sid, transport);

            // Restore session data from store
            const metadata = await sessionStore.get(sid);
            const sessionData: SessionData = {
              transport,
              server,
              lastAccessedAt: Date.now(),
              context: c,
              honoContext: c,
              ...(metadata || {}),
            };
            sessions.set(sid, sessionData);

            // Re-register oninitialized handler
            server.server.oninitialized = async () => {
              const clientCapabilities = server.server.getClientCapabilities();
              const clientInfo = (server.server as any).getClientInfo?.() || {};
              const protocolVersion =
                (server.server as any).getProtocolVersion?.() || "unknown";

              const metadata = await sessionStore.get(sid);
              if (metadata) {
                metadata.clientCapabilities = clientCapabilities;
                metadata.clientInfo = clientInfo;
                metadata.protocolVersion = String(protocolVersion);
                await sessionStore.set(sid, metadata);
              }

              const sessionData = sessions.get(sid);
              if (sessionData) {
                sessionData.clientCapabilities = clientCapabilities;
              }

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

              // Send list_changed notifications after reconnected session is ready
              // This triggers the client to refresh its cached lists after hot reload
              if (!isProductionMode) {
                console.log(
                  `[MCP] Development mode: Sending list_changed notifications to reconnected session ${sid}`
                );
                try {
                  const { sendNotificationToSession } =
                    await import("../sessions/notifications.js");
                  await sendNotificationToSession(
                    sessions,
                    sid,
                    "notifications/tools/list_changed"
                  );
                  await sendNotificationToSession(
                    sessions,
                    sid,
                    "notifications/resources/list_changed"
                  );
                  await sendNotificationToSession(
                    sessions,
                    sid,
                    "notifications/prompts/list_changed"
                  );
                } catch (err) {
                  console.debug(
                    `[MCP] Failed to send list_changed notification:`,
                    err
                  );
                }
              }
            };
          },

          onsessionclosed: async (sid: string) => {
            console.log(`[MCP] Session closed: ${sid}`);
            transports.delete(sid);
            await streamManager.delete(sid);
            await sessionStore.delete(sid);
            sessions.delete(sid);
            mcpServerInstance.cleanupSessionSubscriptions?.(sid);
            mcpServerInstance.cleanupSessionRefs?.(sid);
          },
        });

        await server.connect(transport);

        // Wrap in request context so tool/resource callbacks can access headers
        return await runWithContext(c, () =>
          transport.handleRequest(c.req.raw)
        );
      }

      // Check if session ID doesn't exist in store at all (truly invalid)
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

        // Wrap in request context so tool/resource callbacks can access headers
        // Pass Web Standard Request directly - no adapter needed!
        return await runWithContext(c, () =>
          transport.handleRequest(c.req.raw)
        );
      }

      // For new sessions or initialization, create new transport and server
      // Generate session ID first so we can pass it to getServerForSession for ref storage
      const newSessionId = generateUUID();
      const server = mcpServerInstance.getServerForSession(newSessionId);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,

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

          // Clean up registered refs for hot reload support
          mcpServerInstance.cleanupSessionRefs?.(sid);
        },
      });

      // Connect server to transport
      await server.connect(transport);

      // Wrap in request context so tool/resource callbacks can access headers
      // Pass Web Standard Request directly - no adapter needed!
      return await runWithContext(c, () => transport.handleRequest(c.req.raw));
    }
  };

  // Mount the handler for all HTTP methods on both /mcp and /sse
  for (const endpoint of ["/mcp", "/sse"]) {
    // @ts-expect-error - Hono types don't perfectly match but runtime works correctly
    app.on(["GET", "POST", "DELETE", "HEAD"], endpoint, handleRequest);
  }

  console.log(
    `[MCP] Server mounted at /mcp and /sse (${config.stateless ? "stateless" : "stateful"} mode)`
  );

  return { mcpMounted: true, idleCleanupInterval };
}
