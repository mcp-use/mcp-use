/**
 * A local stand-in for Manufact Cloud's HTTP API.
 *
 * Cloud is the one real outside boundary for cloud commands, so tests fake it
 * at the network layer instead of mocking modules. Each test registers the
 * routes it needs; the server records every request it receives so the test
 * can assert on what the CLI sent, which is behaviour Cloud observes.
 *
 * Any request with no matching route gets a 501 and is kept in `unhandled`.
 * The `cloud` fixture in `cli-test.ts` fails the test if that list is not
 * empty, so an unexpected or duplicated call never passes silently.
 */
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

/** One request the fake received, in arrival order. */
export interface RecordedRequest {
  /** Upper-case HTTP method. */
  method: string;
  /** Full pathname, without the query string, e.g. `/api/v1/deployments`. */
  path: string;
  /** Query string parameters. Repeated keys keep the last value. */
  query: Record<string, string>;
  /** Lower-cased request headers, as Node parsed them. */
  headers: IncomingHttpHeaders;
  /**
   * Request body: parsed JSON for JSON content types, a string for other
   * non-empty bodies, and `undefined` when there is no body.
   */
  body: unknown;
  /** The raw body bytes, for multipart or binary uploads. */
  rawBody: Buffer;
}

/** What a route sends back. */
export interface FakeResponse {
  /** HTTP status. Defaults to 200. */
  status?: number;
  /** JSON-encoded as the response body. Omit for an empty body. */
  body?: unknown;
  /** Extra response headers. */
  headers?: Record<string, string>;
}

/** A fixed response, or a function of the request. */
export type RouteReply =
  | FakeResponse
  | ((request: RecordedRequest) => FakeResponse | Promise<FakeResponse>);

/** A running fake Cloud. */
export interface FakeCloud {
  /** Origin, e.g. `http://127.0.0.1:53211`. */
  readonly origin: string;
  /** Value for `MCP_USE_CLOUD_API_URL`: the origin plus `/api/v1`. */
  readonly apiUrl: string;
  /** Every request received, matched or not, in arrival order. */
  readonly requests: readonly RecordedRequest[];
  /** Requests that matched no route. They were answered with a 501. */
  readonly unhandled: readonly RecordedRequest[];
  /**
   * Answer `method path` with `reply` every time it is called.
   *
   * `path` is the full pathname with no query string. Registering the same
   * method and path again replaces the earlier route.
   */
  on(method: string, path: string, reply: RouteReply): void;
  /**
   * Answer `method path` with each reply in turn, one per call.
   *
   * A call after the last reply is treated as unhandled, so a test that
   * registers two replies also proves the CLI made no third call.
   */
  sequence(method: string, path: string, replies: readonly RouteReply[]): void;
  /** Requests received for one method and path, in arrival order. */
  requestsTo(method: string, path: string): RecordedRequest[];
  /** Stop the server and drop open connections. */
  close(): Promise<void>;
}

/** Start a fake Cloud on a free localhost port. */
export async function startFakeCloud(): Promise<FakeCloud> {
  const routes = new Map<string, () => RouteReply | undefined>();
  const requests: RecordedRequest[] = [];
  const unhandled: RecordedRequest[] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        const recorded = record(req.method ?? "GET", req.url ?? "/", {
          headers: req.headers,
          rawBody: Buffer.concat(chunks),
        });
        requests.push(recorded);
        const reply = routes.get(key(recorded.method, recorded.path))?.();
        let response: FakeResponse;
        if (reply === undefined) {
          unhandled.push(recorded);
          response = {
            status: 501,
            body: {
              error: `fake-cloud: no route for ${recorded.method} ${recorded.path}`,
            },
          };
        } else {
          try {
            response =
              typeof reply === "function" ? await reply(recorded) : reply;
          } catch (error) {
            response = {
              status: 500,
              body: {
                error: `fake-cloud: route handler threw: ${String(error)}`,
              },
            };
          }
        }
        const text =
          response.body === undefined ? "" : JSON.stringify(response.body);
        res.writeHead(response.status ?? 200, {
          ...(text !== "" ? { "Content-Type": "application/json" } : {}),
          ...response.headers,
        });
        res.end(text);
      })();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    apiUrl: `${origin}/api/v1`,
    requests,
    unhandled,
    on(method, path, reply) {
      routes.set(key(method, path), () => reply);
    },
    sequence(method, path, replies) {
      let next = 0;
      routes.set(key(method, path), () => replies[next++]);
    },
    requestsTo(method, path) {
      return requests.filter(
        (request) =>
          request.method === method.toUpperCase() && request.path === path
      );
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function key(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function record(
  method: string,
  url: string,
  raw: { headers: IncomingHttpHeaders; rawBody: Buffer }
): RecordedRequest {
  const parsed = new URL(url, "http://fake-cloud.invalid");
  const text = raw.rawBody.toString("utf8");
  let body: unknown;
  if (text !== "") {
    const isJson = /\bjson\b/i.test(raw.headers["content-type"] ?? "");
    try {
      body = isJson ? JSON.parse(text) : text;
    } catch {
      body = text;
    }
  }
  const recorded = {
    method: method.toUpperCase(),
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams),
    headers: raw.headers,
    body,
  } as RecordedRequest;
  // Non-enumerable so assertion diffs on requests don't print every byte.
  Object.defineProperty(recorded, "rawBody", { value: raw.rawBody });
  return recorded;
}
