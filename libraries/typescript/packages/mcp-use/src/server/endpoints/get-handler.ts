/**
 * GET Handler for SSE Streaming
 *
 * Handles GET requests for Server-Sent Events (SSE) streaming.
 */

import type { Context } from "hono";
import type { SessionData } from "../sessions/index.js";
import { validateSession, setupAbortSignal } from "./shared-helpers.js";

/**
 * Handle GET requests for SSE streaming
 */
export async function handleGetRequest(
  c: Context,
  sessions: Map<string, SessionData>,
  getOrCreateTransport: (sessionId?: string, isInit?: boolean) => Promise<any>
): Promise<Response> {
  const sessionId = c.req.header("mcp-session-id");

  // Get or create transport for this session
  const transport = await getOrCreateTransport(sessionId, false);

  // Validate session
  const validationError = validateSession(sessionId, transport);
  if (validationError) {
    return c.json(validationError.error, validationError.statusCode);
  }

  // Update last accessed time if session exists
  if (sessionId && sessions.has(sessionId)) {
    sessions.get(sessionId)!.lastAccessedAt = Date.now();
  }

  // Setup abort signal handling
  setupAbortSignal(c, transport);

  // For streaming, we need to return a Response with a ReadableStream immediately
  const { readable, writable } = new (globalThis as any).TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Create a promise to track when headers are received
  let resolveResponse: (res: Response) => void;
  const responsePromise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });

  let headersSent = false;
  const headers: Record<string, string> = {};
  let statusCode = 200;

  const expressRes: any = {
    statusCode: 200,
    headersSent: false,
    status: (code: number) => {
      statusCode = code;
      expressRes.statusCode = code;
      return expressRes;
    },
    setHeader: (name: string, value: string | string[]) => {
      if (!headersSent) {
        headers[name] = Array.isArray(value) ? value.join(", ") : value;
      }
    },
    getHeader: (name: string) => headers[name],
    write: (chunk: any) => {
      if (!headersSent) {
        headersSent = true;
        resolveResponse(
          new Response(readable, {
            status: statusCode,
            headers,
          })
        );
      }
      const data =
        typeof chunk === "string"
          ? encoder.encode(chunk)
          : chunk instanceof Uint8Array
            ? chunk
            : Buffer.from(chunk);
      writer.write(data);
      return true;
    },
    end: (chunk?: any) => {
      if (chunk) {
        expressRes.write(chunk);
      }
      if (!headersSent) {
        headersSent = true;
        // Empty body case
        resolveResponse(
          new Response(null, {
            status: statusCode,
            headers,
          })
        );
        writer.close();
      } else {
        writer.close();
      }
    },
    on: (event: string, handler: any) => {
      if (event === "close") {
        expressRes._closeHandler = handler;
      }
    },
    once: () => {},
    removeListener: () => {},
    writeHead: (code: number, _headers?: any) => {
      statusCode = code;
      expressRes.statusCode = code;
      if (_headers) {
        Object.assign(headers, _headers);
      }
      if (!headersSent) {
        headersSent = true;
        resolveResponse(
          new Response(readable, {
            status: statusCode,
            headers,
          })
        );
      }
      return expressRes;
    },
    flushHeaders: () => {
      // No-op - headers are flushed on first write
    },
  };

  // Mock expressReq
  const expressReq: any = {
    ...c.req.raw,
    url: new URL(c.req.url).pathname + new URL(c.req.url).search,
    path: new URL(c.req.url).pathname,
    query: Object.fromEntries(new URL(c.req.url).searchParams),
    headers: c.req.header(),
    method: c.req.method,
  };

  // Start handling the request
  transport.handleRequest(expressReq, expressRes).catch((err: any) => {
    console.error("MCP Transport error:", err);
    try {
      writer.close();
    } catch {
      // Ignore errors when closing writer
    }
  });

  return responsePromise;
}
