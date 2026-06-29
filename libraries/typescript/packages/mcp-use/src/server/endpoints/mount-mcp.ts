/**
 * MCP Endpoint Mounting
 *
 * Main orchestration function for mounting MCP endpoints at /mcp.
 * Uses official SDK Streamable HTTP transport primitives under the Hono route
 * shell that mcp-use owns.
 *
 * V2 should stay stateless-first at the product layer. Stateful session and
 * stream-manager paths are compatibility/runtime plumbing for clients that need
 * long-lived streams; new framework behavior should use request-scoped metadata,
 * auth context, explicit handles, or persisted resources instead of remembered
 * initialize/session state.
 */

import type { Context, Hono as HonoType } from "hono";
import { join } from "node:path";
import { Telemetry } from "../../telemetry/telemetry-node.js";
import { generateLandingPage } from "../landing.js";
import {
  createSdkStreamableHttpTransport,
  type SdkMcpServer,
} from "../sdk-bridge.js";
import type { SessionData, StreamManager } from "../sessions/index.js";
import {
  FileSystemSessionStore,
  InMemorySessionStore,
  InMemoryStreamManager,
  startIdleCleanup,
} from "../sessions/index.js";
import type { ServerConfig } from "../types/index.js";
import { runWithContext } from "../context-storage.js";
import { getDebugLevel } from "../logging.js";
import {
  maybeForwardResponses,
  registerSseStream,
  type StreamableTransportWithSdkInternals,
  wrapTransportForStreamManager,
} from "../transport/stream-routing.js";
import { generateUUID } from "../utils/runtime.js";

type RequestInitWithDuplex = RequestInit & { duplex?: "half" };

/**
 * Mount MCP server endpoints at /mcp.
 *
 * This is an internal boundary between the mcp-use Hono application and the
 * official SDK transport. Keep protocol behavior delegated to the SDK where
 * possible; any private transport access should be isolated here or in transport
 * helpers with a clear SDK-version test/removal path.
 */
export async function mountMcp(
  app: HonoType,
  mcpServerInstance: {
    getServerForSession: (sessionId?: string) => SdkMcpServer;
    cleanupSessionSubscriptions?: (sessionId: string) => void;
    cleanupSessionRefs?: (sessionId: string) => void;
  }, // The McpServer instance with getServerForSession() method
  sessions: Map<string, SessionData>,
  config: ServerConfig,
  isProductionMode: boolean
): Promise<{ mcpMounted: boolean; idleCleanupInterval?: NodeJS.Timeout }> {
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
          path: join(process.cwd(), ".mcp-use", "state", "sessions.json"),
        }));

  // Initialize stream manager (pluggable - can be Redis Pub/Sub, Postgres NOTIFY, etc.)
  // Manages active SSE connections for notifications, sampling, resource subscriptions
  const streamManager: StreamManager =
    config.streamManager ?? new InMemoryStreamManager();

  // Map to store transports by session ID (following official Hono example from PR #1209)
  const transports = new Map<string, StreamableTransportWithSdkInternals>();

  // Set up distributed response forwarding: when another server forwards a
  // JSON-RPC response (e.g. a sampling result) to us via Redis Pub/Sub, feed
  // it into the local transport so the SDK Protocol resolves the pending Promise.
  if (streamManager.onForwardedResponse) {
    streamManager.onForwardedResponse((message: unknown, sid: string) => {
      const transport = transports.get(sid);
      if (transport?.onmessage) {
        transport.onmessage(message);
      }
    });
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
        const origin = new URL(fullUrl).origin;
        const instance = mcpServerInstance as {
          favicon?: string;
          config?: { icons?: Array<{ src: string }>; favicon?: string };
          registrations?: {
            tools: Map<string, { config: { description?: string } }>;
            prompts: Map<string, { config: { description?: string } }>;
            resources: Map<
              string,
              { config: { uri: string; name?: string; description?: string } }
            >;
          };
        };
        let iconUrl: string | undefined;
        const iconSrc =
          instance.favicon ??
          instance.config?.favicon ??
          instance.config?.icons?.[0]?.src;
        if (iconSrc) {
          iconUrl = iconSrc.startsWith("http")
            ? iconSrc
            : `${origin}/mcp-use/public/${iconSrc.replace(/^\//, "")}`;
        }
        const regs = instance.registrations;
        const landingTools =
          regs?.tools &&
          Array.from(regs.tools.entries()).map(([name, r]) => ({
            name,
            description: r.config.description,
          }));
        const landingPrompts =
          regs?.prompts &&
          Array.from(regs.prompts.entries()).map(([name, r]) => ({
            name,
            description: r.config.description || undefined,
          }));
        const landingResources =
          regs?.resources &&
          Array.from(regs.resources.values()).map((r) => ({
            uri: r.config.uri,
            name: r.config.name,
            description: r.config.description,
          }));
        const landingPage = generateLandingPage(
          config.name,
          config.version,
          fullUrl,
          config.description,
          landingTools?.length ? landingTools : undefined,
          landingPrompts?.length ? landingPrompts : undefined,
          landingResources?.length ? landingResources : undefined,
          iconUrl
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
      const sdkTransport = createSdkStreamableHttpTransport({
        sessionIdGenerator: undefined, // No session tracking
        // IMPORTANT: Always use JSON responses in stateless mode
        // Edge runtimes (Deno, Cloudflare Workers, Supabase) cannot maintain long-lived SSE streams
        // Even if client supports SSE, we must use request-response JSON in stateless environments
        enableJsonResponse: true,
      });
      const transport =
        sdkTransport as unknown as StreamableTransportWithSdkInternals;

      try {
        await server.connect(sdkTransport);

        // If client doesn't support SSE, add the Accept header to bypass SDK validation
        // The transport requires Accept: text/event-stream even when using enableJsonResponse
        const request = c.req.raw;
        if (!clientSupportsSSE) {
          // Clone request with modified headers.
          const requestInit: RequestInitWithDuplex = {
            method: request.method,
            headers: {
              ...Object.fromEntries(request.headers.entries()),
              Accept: "application/json, text/event-stream",
            },
            body: request.body,
          };
          if (request.body) {
            requestInit.duplex = "half";
          }
          const modifiedRequest = new Request(request.url, requestInit);
          return await runWithContext(c, async () =>
            transport.handleRequest(modifiedRequest)
          );
        }

        return await runWithContext(c, async () =>
          transport.handleRequest(request)
        );
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

      // Session metadata exists in store but transport was lost (server restart / deploy)
      // Recreate the transport and restore its initialized state so any request type
      // (not just initialize) works immediately after recovery.
      // See: https://github.com/mcp-use/mcp-use/issues/1133
      if (
        sessionId &&
        (await sessionStore.has(sessionId)) &&
        !transports.has(sessionId)
      ) {
        console.log(
          `[MCP] Session metadata found but transport lost (restart/hot-reload): ${sessionId} - recovering`
        );

        const server = mcpServerInstance.getServerForSession(sessionId);
        const sdkTransport = createSdkStreamableHttpTransport({
          sessionIdGenerator: () => sessionId,

          onsessioninitialized: async (sid: string) => {
            if (getDebugLevel() !== "info") {
              console.log(`[MCP] Session re-initialized: ${sid}`);
            }
          },

          onsessionclosed: async (sid: string) => {
            if (getDebugLevel() !== "info") {
              console.log(`[MCP] Session closed: ${sid}`);
            }
            transports.delete(sid);
            await streamManager.delete(sid);
            await sessionStore.delete(sid);
            sessions.delete(sid);
            mcpServerInstance.cleanupSessionSubscriptions?.(sid);
            mcpServerInstance.cleanupSessionRefs?.(sid);
          },
        });
        const transport =
          sdkTransport as unknown as StreamableTransportWithSdkInternals;

        wrapTransportForStreamManager(transport, sessionId, streamManager);

        await server.connect(sdkTransport);

        // The SDK transport only sets _initialized and sessionId when it processes
        // an actual `initialize` request. Since this session was already established
        // before the restart, we restore that state directly so the transport
        // accepts any request type (tools/call, resources/read, etc.).
        transport._initialized = true;
        transport.sessionId = sessionId;

        // Register immediately — don't wait for onsessioninitialized which only
        // fires on initialize requests and won't trigger for recovered sessions.
        transports.set(sessionId, transport);
        const metadata = await sessionStore.get(sessionId);
        const sessionData: SessionData = {
          transport: sdkTransport,
          server,
          lastAccessedAt: Date.now(),
          context: c,
          honoContext: c,
          ...(metadata || {}),
        };
        sessions.set(sessionId, sessionData);

        if (c.req.method === "POST") {
          await maybeForwardResponses(c.req.raw, sessionId, streamManager);
        }
        const recoveryResponse = await runWithContext(
          c,
          async () => transport.handleRequest(c.req.raw),
          sessionId
        );
        if (c.req.method === "GET") {
          await registerSseStream(transport, sessionId, streamManager);
        }
        return recoveryResponse;
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

        if (c.req.method === "POST") {
          await maybeForwardResponses(c.req.raw, sessionId, streamManager);
        }
        const existingResponse = await runWithContext(
          c,
          async () => transport.handleRequest(c.req.raw),
          sessionId
        );
        if (c.req.method === "GET") {
          await registerSseStream(transport, sessionId, streamManager);
        }
        return existingResponse;
      }

      // For new sessions or initialization, create new transport and server
      // Generate session ID first so we can pass it to getServerForSession for ref storage
      const newSessionId = generateUUID();
      const server = mcpServerInstance.getServerForSession(newSessionId);
      const sdkTransport = createSdkStreamableHttpTransport({
        sessionIdGenerator: () => newSessionId,

        onsessioninitialized: async (sid: string) => {
          if (getDebugLevel() !== "info") {
            console.log(`[MCP] Session initialized: ${sid}`);
          }
          transports.set(sid, transport);

          // Store full session data in memory (includes transport, server, context)
          const sessionData: SessionData = {
            transport: sdkTransport,
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
            const sdkServer = server.server as typeof server.server & {
              getClientInfo?: () => unknown;
              getProtocolVersion?: () => unknown;
            };
            const clientInfo = (server.server.getClientVersion?.() ||
              sdkServer.getClientInfo?.()) as
              | SessionData["clientInfo"]
              | undefined;
            const protocolVersion =
              sdkServer.getProtocolVersion?.() || "unknown";

            // Update metadata in sessionStore
            const metadata = await sessionStore.get(sid);
            if (metadata) {
              metadata.clientCapabilities = clientCapabilities;
              metadata.clientInfo = clientInfo;
              metadata.protocolVersion = String(protocolVersion);
              await sessionStore.set(sid, metadata);

              if (getDebugLevel() !== "info") {
                console.log(
                  `[MCP] Captured client capabilities for session ${sid}:`,
                  clientCapabilities ? Object.keys(clientCapabilities) : "none"
                );
              }
            }

            // Update in-memory session data
            const sessionData = sessions.get(sid);
            if (sessionData) {
              sessionData.clientCapabilities = clientCapabilities;
              sessionData.clientInfo = clientInfo;
            }

            // Track server initialize event
            Telemetry.getInstance()
              .trackServerInitialize({
                protocolVersion: String(protocolVersion),
                clientInfo: (clientInfo ?? {}) as Record<string, unknown>,
                clientCapabilities: clientCapabilities || {},
                sessionId: sid,
              })
              .catch((e) =>
                console.debug(`Failed to track server initialize: ${e}`)
              );
          };
        },

        onsessionclosed: async (sid: string) => {
          if (getDebugLevel() !== "info") {
            console.log(`[MCP] Session closed: ${sid}`);
          }
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
      const transport =
        sdkTransport as unknown as StreamableTransportWithSdkInternals;

      wrapTransportForStreamManager(transport, newSessionId, streamManager);

      // Connect server to transport
      await server.connect(sdkTransport);

      const newSessionResponse = await runWithContext(
        c,
        async () => transport.handleRequest(c.req.raw),
        newSessionId
      );
      if (c.req.method === "GET") {
        await registerSseStream(transport, newSessionId, streamManager);
      }
      return newSessionResponse;
    }
  };

  app.on(["GET", "POST", "DELETE", "HEAD"], "/mcp", handleRequest);

  console.log(
    `[MCP] Server mounted at /mcp (${config.stateless ? "stateless" : "stateful"} mode)`
  );

  return { mcpMounted: true, idleCleanupInterval };
}
