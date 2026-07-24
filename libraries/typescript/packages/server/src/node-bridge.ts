/**
 * Vendored from `@modelcontextprotocol/node` `toNodeHandler.ts` (SDK 2.0.0-beta.4).
 * ponytail: track upstream SSE/backpressure fixes when bumping `@modelcontextprotocol/server`.
 *
 * @internal Bundled into the Node root; remains free of runtime Node imports
 * so the generic edge graph can reuse the response adapter safely.
 */
import type {
  AuthInfo,
  McpHandlerRequestOptions,
} from "@modelcontextprotocol/server";

/** Minimal duck-typed shape of a Node.js `IncomingMessage`. */
export interface NodeIncomingMessageLike extends AsyncIterable<
  Uint8Array | string
> {
  method?: string | undefined;
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthInfo;
}

/** Minimal duck-typed shape of a Node.js `ServerResponse`. */
export interface NodeServerResponseLike {
  writeHead(statusCode: number, headers?: Record<string, string>): unknown;
  write(chunk: string | Uint8Array): unknown;
  end(chunk?: string | Uint8Array): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  destroyed?: boolean;
}

/** Web-standard fetch face accepted by {@link toNodeHandler}. */
export interface FetchLikeHandler {
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
  onerror?: (error: Error) => void;
}

/**
 * Adapt a web-standard `fetch` handler to Node `(req, res, parsedBody?)`.
 *
 * @param handler - Handler whose `fetch` receives converted `Request` objects.
 * @param opts - Optional adapter error observer.
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

    let response: Response;
    try {
      const request = await toWebRequest(req, parsedBody, {
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

    const headers: Record<string, string> = {};
    for (const [name, value] of response.headers) {
      headers[name] = value;
    }
    res.writeHead(response.status, headers);
    if (response.body === null) {
      finished = true;
      res.end();
      return;
    }

    // MCP request/response payloads are ordinary buffered JSON. Avoid routing
    // those through the async ReadableStream iterator used for SSE and other
    // streaming responses: it adds a promise turn and backpressure bookkeeping
    // for every chunk on the hottest server path.
    if (
      response.headers
        .get("content-type")
        ?.toLowerCase()
        .includes("application/json")
    ) {
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
  signal?: AbortSignal;
}

/**
 * Convert a duck-typed Node request to a web-standard `Request`.
 *
 * @param req - Node `IncomingMessage` (or Express `req`).
 * @param parsedBody - Optional pre-parsed JSON body.
 * @param options - Optional abort signal for the constructed request.
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

  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    if (parsedBody === undefined) {
      const decoder = new TextDecoder();
      let collected = "";
      for await (const chunk of req) {
        collected +=
          typeof chunk === "string"
            ? chunk
            : decoder.decode(chunk as Uint8Array, { stream: true });
      }
      collected += decoder.decode();
      if (collected.length > 0) {
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
