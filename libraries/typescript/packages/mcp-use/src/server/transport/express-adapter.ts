/**
 * Express-like Adapter
 *
 * Converts Hono Context to Express-like request/response objects
 * for compatibility with the MCP SDK's StreamableHTTPServerTransport.
 */

import type { Context } from "hono";
import { isDeno } from "../utils/runtime.js";

/**
 * Express-like request object
 */
export interface ExpressRequest {
  url: string;
  originalUrl: string;
  baseUrl: string;
  path: string;
  query: Record<string, any>;
  params: Record<string, any>;
  body: any;
  headers: Record<string, string>;
  method: string;
  header?: (name: string) => string | undefined;
}

/**
 * Express-like response object
 */
export interface ExpressResponse {
  statusCode: number;
  headersSent: boolean;
  status: (code: number) => ExpressResponse;
  setHeader: (name: string, value: string | string[]) => void;
  getHeader: (name: string) => string | undefined;
  write: (chunk: any, encoding?: any, callback?: any) => boolean;
  end: (chunk?: any, encoding?: any, callback?: any) => void;
  on: (event: string, handler: any) => void;
  once: () => void;
  removeListener: () => void;
  writeHead: (code: number, headers?: any) => ExpressResponse;
  flushHeaders: () => void;
  send?: (body: any) => void;
  _closeHandler?: any;
}

/**
 * Return type for createExpressLikeObjects
 */
export interface ExpressLikeObjects {
  expressReq: ExpressRequest;
  expressRes: ExpressResponse;
  getResponse: () => Response | null;
  isSSEStream: () => boolean;
  waitForSSEStream: () => Promise<Response>;
}

/**
 * Create Express-like req/res objects from Hono context for MCP SDK
 *
 * The MCP SDK's StreamableHTTPServerTransport expects Express-like request
 * and response objects. This function adapts Hono's Context to provide
 * compatible interfaces.
 *
 * @param c - Hono context
 * @returns Express-like request/response objects and utilities
 */
export function createExpressLikeObjects(c: Context): ExpressLikeObjects {
  const req = c.req.raw;
  const responseBody: Uint8Array[] = [];
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let ended = false;
  let headersSent = false;
  let isSSEStream = false;
  let streamWriter: any = null; // WritableStreamDefaultWriter<Uint8Array>
  let streamingResponse: Response | null = null;
  let sseStreamReady: ((response: Response) => void) | null = null;
  const sseStreamPromise = new Promise<Response>((resolve) => {
    sseStreamReady = resolve;
  });

  const expressReq: ExpressRequest = {
    ...req,
    url: new URL(req.url).pathname + new URL(req.url).search,
    originalUrl: req.url,
    baseUrl: "",
    path: new URL(req.url).pathname,
    query: Object.fromEntries(new URL(req.url).searchParams),
    params: {},
    body: {},
    headers:
      req.headers && typeof req.headers.entries === "function"
        ? Object.fromEntries(req.headers.entries())
        : (req.headers as any),
    method: req.method,
  };

  const expressRes: ExpressResponse = {
    statusCode: 200,
    headersSent: false,
    status: (code: number) => {
      statusCode = code;
      expressRes.statusCode = code;
      return expressRes;
    },
    setHeader: (name: string, value: string | string[]) => {
      if (!headersSent) {
        headers[name.toLowerCase()] = Array.isArray(value)
          ? value.join(", ")
          : value;
        // Detect SSE when Content-Type is set to text/event-stream
        if (
          name.toLowerCase() === "content-type" &&
          (Array.isArray(value) ? value.join(", ") : value).includes(
            "text/event-stream"
          )
        ) {
          isSSEStream = true;
          // Create TransformStream for SSE
          const { readable, writable } = new (
            globalThis as any
          ).TransformStream();
          streamWriter = writable.getWriter();
          streamingResponse = new Response(readable, {
            status: statusCode,
            headers: headers,
          });
          // Resolve the promise so the POST handler can return the stream immediately
          if (sseStreamReady) {
            sseStreamReady(streamingResponse);
          }
        }
      }
    },
    getHeader: (name: string) => headers[name.toLowerCase()],
    write: (chunk: any, encoding?: any, callback?: any) => {
      if (!ended || isSSEStream) {
        const data =
          typeof chunk === "string"
            ? new TextEncoder().encode(chunk)
            : chunk instanceof Uint8Array
              ? chunk
              : Buffer.from(chunk);

        // For SSE streams, write directly to the stream
        if (isSSEStream && streamWriter) {
          streamWriter.write(data).catch(() => {
            // Ignore write errors (client may have disconnected)
          });
        } else {
          // Buffer for non-SSE responses
          responseBody.push(data);
        }
      }
      if (typeof encoding === "function") {
        encoding();
      } else if (callback) {
        callback();
      }
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

        // For SSE streams, write to stream but DON'T close it yet
        // The SDK will manage when to close the stream
        if (isSSEStream && streamWriter) {
          streamWriter.write(data).catch(() => {
            // Ignore write errors (client may have disconnected)
          });
          // Don't close the stream here - let the SDK manage it
        } else {
          responseBody.push(data);
        }
      }
      // For SSE streams, don't mark as ended - the stream stays open
      // The SDK will close it when all responses are sent
      if (!isSSEStream) {
        ended = true;
      }
      if (typeof encoding === "function") {
        encoding();
      } else if (callback) {
        callback();
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
      headersSent = true;
      if (_headers) {
        // Handle both object and array of header tuples
        // Normalize all keys to lowercase for consistent access
        if (Array.isArray(_headers)) {
          // Array format: [['Content-Type', 'text/event-stream'], ...]
          for (const [name, value] of _headers) {
            headers[name.toLowerCase()] = value;
          }
        } else {
          // Object format: { 'Content-Type': 'text/event-stream', ... }
          // Normalize keys to lowercase
          for (const [key, value] of Object.entries(_headers)) {
            headers[key.toLowerCase()] = value as string;
          }
        }

        // Check if SSE headers are being set
        const contentType = headers["content-type"];
        if (contentType && contentType.includes("text/event-stream")) {
          isSSEStream = true;
          // Create TransformStream for SSE
          const { readable, writable } = new (
            globalThis as any
          ).TransformStream();
          streamWriter = writable.getWriter();
          streamingResponse = new Response(readable, {
            status: statusCode,
            headers: headers,
          });
          // Resolve the promise so the POST handler can return the stream immediately
          if (sseStreamReady) {
            sseStreamReady(streamingResponse);
          }
        }
      }
      return expressRes;
    },
    flushHeaders: () => {
      headersSent = true;
      // For SSE streaming, headers are already set in streamingResponse
    },
    send: (body: any) => {
      if (!ended) {
        expressRes.write(body);
        expressRes.end();
      }
    },
  };

  return {
    expressReq,
    expressRes,
    getResponse: () => {
      // For SSE streams, return the streaming response immediately
      if (isSSEStream && streamingResponse) {
        return streamingResponse;
      }
      // For buffered responses, return after end is called
      if (ended) {
        if (responseBody.length > 0) {
          const body = isDeno
            ? Buffer.concat(responseBody)
            : Buffer.concat(responseBody);
          return new Response(body, {
            status: statusCode,
            headers: headers,
          });
        } else {
          return new Response(null, {
            status: statusCode,
            headers: headers,
          });
        }
      }
      return null;
    },
    isSSEStream: () => isSSEStream,
    waitForSSEStream: () => sseStreamPromise,
  };
}
