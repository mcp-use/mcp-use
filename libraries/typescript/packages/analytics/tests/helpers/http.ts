import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

/** A running HTTP server for tests. */
export interface TestServer {
  /** Base URL, e.g. `http://127.0.0.1:54321`. */
  url: string;
  close(): Promise<void>;
}

/** Serve a Node request listener on an ephemeral loopback port. */
export async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<TestServer> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * A Fetch `Request` for a Node request, whose `signal` aborts when the client
 * goes away before the response finished (as `@hono/node-server`, Next.js and
 * the other Node adapters do).
 */
async function toRequest(
  req: IncomingMessage,
  res: ServerResponse,
  base: string
): Promise<Request> {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = req.method ?? "GET";
  return new Request(new URL(req.url ?? "/", base), {
    method,
    headers,
    signal: controller.signal,
    ...(method !== "GET" &&
      method !== "HEAD" && { body: Buffer.concat(chunks) }),
  });
}

async function sendResponse(
  response: Response,
  res: ServerResponse
): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  res.writeHead(response.status, headers);
  if (response.body === null) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  res.on("close", () => {
    reader.cancel().catch(() => undefined);
  });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

/** Serve a Fetch-style handler (SDK v2 `createMcpHandler`, `mcp-handler`). */
export function listenFetch(
  handler: (request: Request) => Promise<Response> | Response
): Promise<TestServer> {
  let base = "http://127.0.0.1";
  const server = listen((req, res) => {
    void (async () => {
      try {
        const response = await handler(await toRequest(req, res, base));
        await sendResponse(response, res);
      } catch (error) {
        if (!res.headersSent) res.writeHead(500);
        res.end(String(error));
      }
    })();
  });
  return server.then((s) => {
    base = s.url;
    return s;
  });
}
