/**
 * Session Manager
 *
 * Handles MCP session management including transport creation, session storage,
 * and idle cleanup for StreamableHTTPServerTransport.
 */

import type { Context } from "hono";
import type { ServerConfig } from "../types/index.js";
import { generateUUID } from "../utils/runtime.js";

/**
 * Session data stored for each active MCP session
 */
export interface SessionData {
  /** StreamableHTTPServerTransport instance for this session */
  transport: any;
  /** Timestamp of last activity for idle timeout tracking */
  lastAccessedAt: number;
  /** Hono context for this session's current request */
  context?: Context;
  /** Progress token for current tool call (if any) */
  progressToken?: number;
  /** Function to send notifications to the client */
  sendNotification?: (notification: {
    method: string;
    params: Record<string, any>;
  }) => Promise<void>;
  /** Express-like response object for notifications */
  expressRes?: any;
  /** Hono context for direct response access */
  honoContext?: Context;
}

/**
 * Transport configuration options
 */
export interface TransportConfig {
  allowedOrigins?: string[];
  enableDnsRebindingProtection: boolean;
}

/**
 * Get transport configuration based on server config and production mode
 */
export function getTransportConfig(
  config: ServerConfig,
  isProduction: boolean
): TransportConfig {
  let allowedOrigins = config.allowedOrigins;
  let enableDnsRebindingProtection = false;

  if (isProduction) {
    // Production mode: Only use explicitly configured origins
    if (allowedOrigins !== undefined) {
      enableDnsRebindingProtection = allowedOrigins.length > 0;
    }
    // If not set in production, DNS rebinding protection is disabled
    // (undefined allowedOrigins = no protection)
  } else {
    // Development mode: Allow all origins (disable DNS rebinding protection)
    // This makes it easy to connect from browser dev tools, inspector, etc.
    allowedOrigins = undefined;
    enableDnsRebindingProtection = false;
  }

  return { allowedOrigins, enableDnsRebindingProtection };
}

/**
 * Create a new transport and session
 */
export async function createNewTransport(
  StreamableHTTPServerTransport: any,
  server: any,
  sessions: Map<string, SessionData>,
  config: TransportConfig,
  closeOldSessionId?: string
): Promise<any> {
  // Close old session if it exists (cleanup)
  if (closeOldSessionId && sessions.has(closeOldSessionId)) {
    try {
      sessions.get(closeOldSessionId)!.transport.close();
    } catch (error) {
      // Ignore errors when closing old session
    }
    sessions.delete(closeOldSessionId);
  }

  const { allowedOrigins, enableDnsRebindingProtection } = config;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => generateUUID(),
    enableJsonResponse: true, // Allow SSE streaming for progress notifications
    allowedOrigins: allowedOrigins,
    enableDnsRebindingProtection: enableDnsRebindingProtection,
    onsessioninitialized: (id: string) => {
      if (id) {
        sessions.set(id, {
          transport,
          lastAccessedAt: Date.now(),
        });
      }
    },
    onsessionclosed: (id: string) => {
      if (id) {
        sessions.delete(id);
      }
    },
  });

  await server.connect(transport);
  return transport;
}

/**
 * Create and auto-initialize a transport for seamless reconnection
 * This is used when autoCreateSessionOnInvalidId is true and client sends
 * a non-initialize request with an invalid/expired session ID
 */
export async function createAndAutoInitializeTransport(
  StreamableHTTPServerTransport: any,
  server: any,
  sessions: Map<string, SessionData>,
  config: TransportConfig,
  oldSessionId: string
): Promise<any> {
  const { allowedOrigins, enableDnsRebindingProtection } = config;

  // Create transport that reuses the OLD session ID
  // This ensures the client's subsequent requests with this session ID will work
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => oldSessionId, // Reuse old session ID!
    enableJsonResponse: false, // Allow SSE streaming for progress notifications
    allowedOrigins: allowedOrigins,
    enableDnsRebindingProtection: enableDnsRebindingProtection,
    // We'll manually store the session, so don't rely on onsessioninitialized
    onsessionclosed: (id: string) => {
      if (id) {
        sessions.delete(id);
      }
    },
  });

  await server.connect(transport);

  // Manually store the transport with the old session ID BEFORE initialization
  // This ensures subsequent requests find it
  sessions.set(oldSessionId, {
    transport,
    lastAccessedAt: Date.now(),
  });

  // Auto-initialize the transport by sending a synthetic initialize request
  // This makes the transport ready to handle other requests
  const initBody = {
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-use-auto-reconnect", version: "1.0.0" },
    },
    id: "__auto_init__",
  };

  // Create synthetic Express-like request/response for initialization
  // Must include proper Accept header that the SDK expects
  const syntheticHeaders: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream", // SDK requires both!
  };
  const syntheticReq: any = {
    method: "POST",
    headers: syntheticHeaders,
    header: (name: string) => syntheticHeaders[name.toLowerCase()],
    body: initBody,
  };

  const syntheticRes: any = {
    statusCode: 200,
    setHeader: () => syntheticRes,
    writeHead: (code: number) => {
      syntheticRes.statusCode = code;
      return syntheticRes; // Return this for chaining (e.g., res.writeHead(400).end(...))
    },
    write: () => true,
    end: () => {},
    on: () => syntheticRes,
    once: () => syntheticRes,
    removeListener: () => syntheticRes,
  };

  // Handle the initialize request
  await new Promise<void>((resolve) => {
    syntheticRes.end = () => {
      resolve();
    };
    transport.handleRequest(syntheticReq, syntheticRes, initBody);
  });

  if (syntheticRes.statusCode !== 200) {
    console.error(
      `[MCP] Auto-initialization failed with status ${syntheticRes.statusCode}`
    );
    // Clean up the failed session
    sessions.delete(oldSessionId);
    throw new Error(`Auto-initialization failed: ${syntheticRes.statusCode}`);
  }

  console.log(
    `[MCP] Auto-initialized session ${oldSessionId} for seamless reconnection`
  );
  return transport;
}

/**
 * Get or create a transport for a session
 */
export async function getOrCreateTransport(
  StreamableHTTPServerTransport: any,
  server: any,
  sessions: Map<string, SessionData>,
  transportConfig: TransportConfig,
  serverConfig: ServerConfig,
  sessionId?: string,
  isInit = false
): Promise<any | null> {
  // For initialize requests, always create a new session (ignore any provided session ID)
  if (isInit) {
    return await createNewTransport(
      StreamableHTTPServerTransport,
      server,
      sessions,
      transportConfig,
      sessionId
    );
  }

  // For non-init requests, reuse existing transport for session
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    // Update last accessed time immediately to prevent cleanup during request processing
    session.lastAccessedAt = Date.now();
    return session.transport;
  }

  // For non-init requests with an invalid session ID
  if (sessionId) {
    // Check if auto-create is enabled (default: true for compatibility with non-compliant clients)
    const autoCreate = serverConfig.autoCreateSessionOnInvalidId ?? true;

    if (autoCreate) {
      // Auto-create AND auto-initialize a new session for seamless reconnection
      // This makes it compatible with non-compliant clients like ChatGPT
      // that don't reinitialize when receiving 404 for invalid session IDs
      console.warn(
        `[MCP] Session ${sessionId} not found (expired or invalid), auto-creating and initializing new session for seamless reconnection`
      );
      return await createAndAutoInitializeTransport(
        StreamableHTTPServerTransport,
        server,
        sessions,
        transportConfig,
        sessionId
      );
    } else {
      // Follow MCP protocol spec: return null to signal session not found
      // This will result in a 404 error response
      return null;
    }
  }

  // No session ID provided for non-init request
  return null;
}

/**
 * Start idle session cleanup interval
 */
export function startIdleCleanup(
  sessions: Map<string, SessionData>,
  idleTimeoutMs: number
): NodeJS.Timeout | undefined {
  if (idleTimeoutMs <= 0) {
    return undefined;
  }

  return setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.lastAccessedAt > idleTimeoutMs) {
        try {
          session.transport.close();
        } catch (error) {
          // Ignore errors when closing expired sessions
        }
        sessions.delete(sessionId);
      }
    }
  }, 60000); // Check every minute
}
