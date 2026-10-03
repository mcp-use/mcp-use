/**
 * Adapt Web-standard MCP handlers to Node.js HTTP request and response objects.
 *
 * @packageDocumentation
 */
// Vendored from @modelcontextprotocol/node toNodeHandler.ts (SDK 2.0.0-beta.4).
// Track upstream SSE and backpressure fixes with SDK upgrades.
import type {
  AuthInfo,
  McpHandlerRequestOptions,
} from "@modelcontextprotocol/server";

import { isBufferedResponse } from "./buffered-response.js";

/** Minimal duck-typed shape of a Node.js `IncomingMessage`. */
export interface NodeIncomingMessageLike extends AsyncIterable<
  Uint8Array | string
> {
  /** HTTP method. Defaults to `GET` when omitted. */
  method?: string | undefined;
  /** Request target. Defaults to `/` when omitted. */
  url?: string | undefined;
  /** Incoming HTTP headers, including `host` or `:authority` when available. */
  headers: Record<string, string | string[] | undefined>;
  /** Verified authentication information forwarded to the Fetch handler. */
  auth?: AuthInfo;
}

/** Minimal duck-typed shape of a Node.js `ServerResponse`. */
export interface NodeServerResponseLike {
  /** Writes the HTTP status and response headers. */
  writeHead(
    statusCode: number,
    headers?: Record<string, string | string[]>
  ): unknown;
  /** Writes a response-body chunk and returns `false` when backpressure applies. */
  write(chunk: string | Uint8Array): unknown;
  /** Completes the response, optionally with a final body chunk. */
  end(chunk?: string | Uint8Array): unknown;
  /** Subscribes to response lifecycle events such as `close` and `drain`. */
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  /** Whether the underlying response stream has already been destroyed. */
  destroyed?: boolean;
}

/** Web-standard fetch face accepted by {@link toNodeHandler}. */
export interface FetchLikeHandler {
  /** Handles a converted Web-standard request. */
  fetch: (
    request: Request,
    options?: McpHandlerRequestOptions
  ) => Promise<Response>;
}

/** Node `(req, res, parsedBody?)` handler produced by {@link toNodeHandler}. */
export type NodeRequestHandler = (
  req: NodeIncomingMessageLike,
  res: NodeServerResponseLike,
  parsedBody?: unknown
) => Promise<void>;

/** Options for {@link toNodeHandler}. */
export interface ToNodeHandlerOptions {
  /** Observes conversion or handler errors before a JSON-RPC error is returned. */
  onerror?: (error: Error) => void;
}

/**
 * Adapt a web-standard `fetch` handler to Node `(req, res, parsedBody?)`.
 *
 * Unless a `parsedBody` is passed, the handler receives the request body as
 * the bytes that were sent.
 *
 * @param handler - Handler whose `fetch` receives converted `Request` objects.
 * @param opts - Optional adapter error observer.
 * @returns A Node-compatible asynchronous request handler.
 *
 * @example
 * ```ts
 * import { createServer } from "node:http";
 * import { MCPServer } from "mcp-use";
 * import { toNodeHandler } from "mcp-use/node";
 *
 * const server = new MCPServer({ name: "example", version: "1.0.0" });
 * createServer(toNodeHandler(server)).listen(3000);
 * ```
 */
export function toNodeHandler(
  handler: FetchLikeHandler,
  opts?: ToNodeHandlerOptions
): NodeRequestHandler {
  return async (req, res, parsedBody) => {
    if (typeof parsedBody === "function") {
      parsedBody = undefined;
    }

    let finished = false;
    const abort = new AbortController();
    res.on("close", () => {
      if (!finished) {
        abort.abort();
      }
    });
    if (res.destroyed === true) {
      abort.abort();
    }

    let request: Request | undefined;
    let response: Response;
    try {
      request = await toWebRequest(req, parsedBody, {
        signal: abort.signal,
      });
      response = await handler.fetch(request, {
        ...(req.auth !== undefined && { authInfo: req.auth }),
        ...(parsedBody !== undefined && { parsedBody }),
      });
    } catch (error) {
      try {
        opts?.onerror?.(
          error instanceof Error ? error : new Error(String(error))
        );
      } catch {
        // Reporting must never alter the response.
      }
      response = internalServerErrorResponse(echoableRequestId(parsedBody));
    }

    const headers: Record<string, string | string[]> = {};
    const setCookies = (
      response.headers as Headers & { getSetCookie?: () => string[] }
    ).getSetCookie?.();
    for (const [name, value] of response.headers) {
      if (name === "set-cookie" && setCookies?.length) {
        headers[name] = setCookies;
        continue;
      }
      headers[name] = value;
    }
    res.writeHead(response.status, headers);
    if (response.body === null) {
      finished = true;
      res.end();
      return;
    }

    // Framework-owned SDK replies carry an explicit buffered-body marker.
    // Avoid the async iterator overhead for those known single-buffer bodies;
    // arbitrary application/json responses remain on the streaming path.
    if (isBufferedResponse(response, request)) {
      try {
        const bytes = new Uint8Array(await response.arrayBuffer());
        finished = true;
        res.end(bytes);
      } catch {
        // Match the streaming path below: an aborted upstream body closes the
        // Node response without turning it into an unhandled rejection.
        finished = true;
        res.end();
      }
      return;
    }

    let drainResolve: (() => void) | undefined;
    const releaseDrainWait = () => {
      drainResolve?.();
      drainResolve = undefined;
    };
    const waitForDrain = (): Promise<void> =>
      new Promise<void>((resolve) => {
        drainResolve = resolve;
      });
    res.on("drain", releaseDrainWait);
    const closed = new Promise<void>((resolve) => {
      abort.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    try {
      for await (const chunk of response.body as ReadableStream<Uint8Array>) {
        if (abort.signal.aborted) {
          break;
        }
        const bytes =
          chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        if (res.write(bytes) === false) {
          await Promise.race([waitForDrain(), closed]);
        }
      }
    } catch {
      // Stream aborted upstream.
    }
    finished = true;
    res.end();
  };
}

/** Options for {@link toWebRequest}. */
export interface ToWebRequestOptions {
  /** Signal that aborts the constructed request. */
  signal?: AbortSignal;
}

/**
 * Convert a duck-typed Node request to a web-standard `Request`.
 *
 * Without `parsedBody`, the body is read from `req` and kept as the bytes that
 * were received. It is not decoded or normalized as text.
 *
 * @param req - Node `IncomingMessage` (or Express `req`).
 * @param parsedBody - Optional pre-parsed JSON body.
 * @param options - Optional abort signal for the constructed request.
 * @returns A Web-standard request with the Node headers and body.
 *
 * @example
 * ```ts
 * import { toWebRequest } from "mcp-use/node";
 *
 * const request = await toWebRequest(incomingMessage);
 * ```
 */
export async function toWebRequest(
  req: NodeIncomingMessageLike,
  parsedBody?: unknown,
  options?: ToWebRequestOptions
): Promise<Request> {
  const method = (req.method ?? "GET").toUpperCase();
  const host =
    singleHeaderValue(req.headers["host"]) ??
    singleHeaderValue(req.headers[":authority"]) ??
    "localhost";
  const url = `http://${host}${req.url ?? "/"}`;

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || name.startsWith(":")) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else {
      headers.set(name, value);
    }
  }

  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD") {
    if (parsedBody === undefined) {
      // Keep the bytes as received. Unlike the SDK bridge this was vendored
      // from, it also serves custom routes, whose uploads and other non-JSON
      // bodies would be corrupted by decoding them as UTF-8 text.
      const parts: BlobPart[] = [];
      let text = "";
      for await (const chunk of req) {
        if (typeof chunk === "string") {
          // Join consecutive string chunks before they are encoded, so a
          // surrogate pair split between two of them stays one character.
          text += chunk;
          continue;
        }
        if (text !== "") {
          parts.push(text);
          text = "";
        }
        // The DOM BlobPart type excludes views over a SharedArrayBuffer, but
        // Blob accepts and copies them at runtime.
        parts.push(chunk as Uint8Array<ArrayBuffer>);
      }
      if (text !== "") {
        parts.push(text);
      }
      // Blob copies the chunks once, and Request reads from the Blob without
      // copying the body again.
      const collected = new Blob(parts);
      if (collected.size > 0) {
        body = collected;
      }
    } else {
      const serialized: string | undefined = JSON.stringify(parsedBody);
      headers.delete("content-encoding");
      headers.delete("transfer-encoding");
      if (serialized === undefined) {
        headers.delete("content-length");
      } else {
        body = serialized;
        headers.set(
          "content-length",
          String(new TextEncoder().encode(serialized).byteLength)
        );
      }
    }
  }

  return new Request(url, {
    method,
    headers,
    ...(options?.signal !== undefined && { signal: options.signal }),
    ...(body !== undefined && { body }),
  });
}

function singleHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function echoableRequestId(body: unknown): string | number | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const { method, id } = body as { method?: unknown; id?: unknown };
  if (typeof method !== "string") {
    return null;
  }
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function internalServerErrorResponse(id: string | number | null): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32_603, message: "Internal server error" },
      id,
    },
    { status: 500 }
  );
}
