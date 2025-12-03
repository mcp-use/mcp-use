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
import { runWithContext } from "../context-storage.js";

/**
 * Create Express-like request/response objects from Hono context
 * This is a minimal adapter for the native SDK's StreamableHTTPServerTransport
 */
function createExpressLikeObjects(c: Context) {
  const req = c.req.raw;
  const url = new URL(req.url);

  // Express-like request object
  const expressReq: any = {
    method: req.method,
    url: url.pathname + url.search,
    headers: Object.fromEntries(req.headers.entries()),
    header: (name: string) => req.headers.get(name) || undefined,
  };

  // For POST requests, we'll set body after reading it
  const responseHeaders: Record<string, string> = {};
  let statusCode = 200;
  let isSSE = false;
  let streamWriter: any = null; // WritableStreamDefaultWriter<Uint8Array>
  let streamingResponse: Response | null = null;
  const responseChunks: Uint8Array[] = [];
  let ended = false;

  // Express-like response object
  const expressRes: any = {
    statusCode: 200,
    headersSent: false,

    status: (code: number) => {
      statusCode = code;
      expressRes.statusCode = code;
      return expressRes;
    },

    setHeader: (name: string, value: string | string[]) => {
      const headerValue = Array.isArray(value) ? value.join(", ") : value;
      responseHeaders[name.toLowerCase()] = headerValue;

      // Detect SSE streaming
      if (
        name.toLowerCase() === "content-type" &&
        headerValue.includes("text/event-stream")
      ) {
        isSSE = true;
      }
    },

    getHeader: (name: string) => responseHeaders[name.toLowerCase()],

    writeHead: (code: number, headers?: any) => {
      statusCode = code;
      expressRes.statusCode = code;
      expressRes.headersSent = true;

      if (headers) {
        if (Array.isArray(headers)) {
          for (const [name, value] of headers) {
            responseHeaders[name.toLowerCase()] = value;
          }
        } else {
          for (const [key, value] of Object.entries(headers)) {
            responseHeaders[key.toLowerCase()] = value as string;
          }
        }
      }

      // Check if this is SSE
      if (responseHeaders["content-type"]?.includes("text/event-stream")) {
        isSSE = true;
        // Create streaming response for SSE
        const transform: any = new (globalThis as any).TransformStream();
        streamWriter = transform.writable.getWriter();
        streamingResponse = new Response(transform.readable, {
          status: statusCode,
          headers: responseHeaders,
        });
      }

      return expressRes;
    },

    write: (chunk: any, encoding?: any, callback?: any) => {
      if (ended && !isSSE) return true;

      const data =
        typeof chunk === "string"
          ? new TextEncoder().encode(chunk)
          : chunk instanceof Uint8Array
            ? chunk
            : Buffer.from(chunk);

      if (isSSE && streamWriter) {
        streamWriter.write(data).catch(() => {});
      } else {
        responseChunks.push(data);
      }

      if (typeof encoding === "function") encoding();
      else if (callback) callback();

      return true;
    },

    end: (chunk?: any, encoding?: any, callback?: any) => {
      if (chunk && !ended) {
        const data =
          typeof chunk === "string"
            ? new TextEncoder().encode(chunk)
            : chunk instanceof Uint8Array
              ? chunk
              : Buffer.from(chunk);

        if (isSSE && streamWriter) {
          streamWriter.write(data).catch(() => {});
        } else {
          responseChunks.push(data);
        }
      }

      if (!isSSE) {
        ended = true;
      }

      if (typeof encoding === "function") encoding();
      else if (callback) callback();
    },

    flushHeaders: () => {
      expressRes.headersSent = true;
    },

    on: () => {},
    once: () => {},
    removeListener: () => {},
  };

  return {
    expressReq,
    expressRes,
    isSSE: () => isSSE,
    getStreamingResponse: () => streamingResponse,
    getBufferedResponse: () => {
      if (ended && responseChunks.length > 0) {
        const body = Buffer.concat(responseChunks);
        return new Response(body, {
          status: statusCode,
          headers: responseHeaders,
        });
      }
      if (ended) {
        return new Response(null, {
          status: statusCode,
          headers: responseHeaders,
        });
      }
      return null;
    },
  };
}

/**
 * Mount MCP server endpoints at /mcp and /sse
 *
 * Implements multi-session support following the official MCP SDK pattern.
 * Each session gets its own transport and server instance for proper isolation.
 * Supports both stateful (reuse transport with session ID) and stateless (new per request) modes.
 */
export async function mountMcp(
  app: HonoType,
  createServer: () => any,
  sessions: Map<string, SessionData>,
  config: ServerConfig,
  isProductionMode: boolean
): Promise<{ mcpMounted: boolean; idleCleanupInterval?: NodeJS.Timeout }> {
  const { StreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

  const idleTimeoutMs = config.sessionIdleTimeoutMs ?? 300000; // Default: 5 minutes

  // Determine allowed origins based on mode
  let allowedOrigins = config.allowedOrigins;
  let enableDnsRebindingProtection = false;

  if (isProductionMode) {
    if (allowedOrigins !== undefined) {
      enableDnsRebindingProtection = allowedOrigins.length > 0;
    }
  } else {
    // Development mode: Allow all origins
    allowedOrigins = undefined;
    enableDnsRebindingProtection = false;
  }

  // Store transports by session ID for reuse (stateful sessions)
  const transports = new Map<string, any>();

  // Start idle cleanup interval if configured
  let idleCleanupInterval: NodeJS.Timeout | undefined;
  if (idleTimeoutMs > 0) {
    idleCleanupInterval = startIdleCleanup(sessions, idleTimeoutMs);
  }

  // Universal request handler for all HTTP methods
  const handleRequest = async (c: Context) => {
    // Check for existing session ID (stateful mode)
    const sessionId = c.req.header("mcp-session-id");

    if (sessionId && transports.has(sessionId)) {
      // Stateful: Reuse existing transport for this session
      const transport = transports.get(sessionId)!;

      // Update session metadata and store context
      if (sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        session.lastAccessedAt = Date.now();
        session.context = c;
        session.honoContext = c;
      }

      // Create Express-like objects
      const {
        expressReq,
        expressRes,
        isSSE,
        getStreamingResponse,
        getBufferedResponse,
      } = createExpressLikeObjects(c);

      // Read body for POST requests
      if (c.req.method === "POST") {
        try {
          expressReq.body = await c.req.json();
        } catch {
          expressReq.body = {};
        }
      }

      // Store expressRes for notifications
      if (sessions.has(sessionId)) {
        sessions.get(sessionId)!.expressRes = expressRes;
      }

      // Execute request within async context
      await runWithContext(c, async () => {
        await new Promise<void>((resolve) => {
          const originalEnd = expressRes.end;
          let hasEnded = false;

          expressRes.end = (...args: any[]) => {
            if (!hasEnded) {
              originalEnd.apply(expressRes, args);
              hasEnded = true;
              resolve();
            }
          };

          // Let the native SDK transport handle the request
          transport
            .handleRequest(expressReq, expressRes, expressReq.body)
            .catch((err: any) => {
              console.error("[MCP] Transport handleRequest error:", err);
              if (!hasEnded) {
                expressRes.end();
              }
            });
        });
      });

      // Return appropriate response
      if (isSSE()) {
        const streamResponse = getStreamingResponse();
        if (streamResponse) return streamResponse;
      }

      const bufferedResponse = getBufferedResponse();
      if (bufferedResponse) return bufferedResponse;

      return c.text("", 200);
    }

    // Stateless or new session: Create new server + transport
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => generateUUID(),
      enableJsonResponse: true,
      allowedOrigins,
      enableDnsRebindingProtection,

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
      },

      onsessionclosed: (sid: string) => {
        console.log(`[MCP] Session closed: ${sid}`);
        transports.delete(sid);
        sessions.delete(sid);
      },
    });

    // Connect the transport to the newly created server
    await server.connect(transport);

    // Create Express-like objects
    const {
      expressReq,
      expressRes,
      isSSE,
      getStreamingResponse,
      getBufferedResponse,
    } = createExpressLikeObjects(c);

    // Read body for POST requests
    if (c.req.method === "POST") {
      try {
        expressReq.body = await c.req.json();
      } catch {
        expressReq.body = {};
      }
    }

    // Store session context for tool callbacks
    const newSessionId = c.req.header("mcp-session-id");
    if (newSessionId && sessions.has(newSessionId)) {
      const session = sessions.get(newSessionId)!;
      session.expressRes = expressRes;
    }

    // Handle abort signal
    c.req.raw.signal?.addEventListener("abort", () => {
      try {
        transport.close();
      } catch (err) {
        console.error("[MCP] Error closing transport on abort:", err);
      }
    });

    // Execute request within async context
    await runWithContext(c, async () => {
      await new Promise<void>((resolve) => {
        const originalEnd = expressRes.end;
        let hasEnded = false;

        expressRes.end = (...args: any[]) => {
          if (!hasEnded) {
            originalEnd.apply(expressRes, args);
            hasEnded = true;
            resolve();
          }
        };

        // Let the native SDK transport handle the request
        transport
          .handleRequest(expressReq, expressRes, expressReq.body)
          .catch((err: any) => {
            console.error("[MCP] Transport handleRequest error:", err);
            if (!hasEnded) {
              expressRes.end();
            }
          });
      });
    });

    // Return appropriate response
    if (isSSE()) {
      const streamResponse = getStreamingResponse();
      if (streamResponse) return streamResponse;
    }

    const bufferedResponse = getBufferedResponse();
    if (bufferedResponse) return bufferedResponse;

    return c.text("", 200);
  };

  // Mount the handler for all HTTP methods on both /mcp and /sse
  for (const endpoint of ["/mcp", "/sse"]) {
    app.on(["GET", "POST", "DELETE"], endpoint, handleRequest);
  }

  console.log(
    `[MCP] Server mounted at /mcp and /sse (multi-session support enabled)`
  );

  return { mcpMounted: true, idleCleanupInterval };
}
