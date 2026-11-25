/**
 * A real loopback webhook receiver with fault knobs, for tests (§18).
 */

import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { importNodeBuiltin } from "../../net/pinned.js";

/** One request recorded by a {@link TestReceiver}. */
export interface TestReceiverRequest {
  /** HTTP method. */
  method: string;
  /** Path and query. */
  path: string;
  /** Request headers, lower-cased; repeated headers joined with `, `. */
  headers: Record<string, string>;
  /** The request body as UTF-8. */
  body: string;
  /** The TLS SNI the client sent, for an HTTPS receiver. */
  servername?: string;
}

/** One delivery the test receiver accepted (the `mcp-use/events/testing` contract shape). */
export interface TestDelivery {
  /** Request headers, lower-cased. */
  headers: Record<string, string>;
  /** Raw body. */
  body: string;
  /** Parsed JSON body, or `undefined` when the body is not JSON. */
  json: unknown;
  /** Receive time (ms since epoch). */
  at: number;
}

/** What a {@link TestReceiver} answers for one request. */
export interface TestReceiverReply {
  /** Status code (default 200). */
  status?: number;
  /** Response headers. */
  headers?: Record<string, string>;
  /** Response body (default empty). */
  body?: string;
  /** Milliseconds to wait before answering. */
  delayMs?: number;
}

/** Options for {@link createTestReceiver}. */
export interface TestReceiverOptions {
  /**
   * Status codes answered in order; the last one repeats. Default `[200]`.
   */
  statuses?: number[];
  /** Delay before answering, one value or a sequence (the last repeats). */
  delayMs?: number | number[];
  /**
   * What the response body contains: `"none"` (empty, the default),
   * `"body"` (the request body), or `"challenge"` (the `challenge` field of
   * a JSON request body, as a JSON `{"challenge": …}` object).
   */
  echo?: "none" | "body" | "challenge";
  /**
   * Answer every request with `307` and this `Location` instead (redirects
   * must not be followed by senders).
   */
  redirectTo?: string;
  /** Headers added to every response (for example `retry-after`). */
  headers?: Record<string, string>;
  /** Full control: overrides `statuses`, `echo` and `redirectTo`. */
  respond?: (
    request: TestReceiverRequest,
    index: number
  ) => TestReceiverReply | Promise<TestReceiverReply>;
  /** Serve HTTPS with this certificate and key (PEM). */
  tls?: { cert: string; key: string };
  /** Interface to listen on. Default `127.0.0.1`. */
  host?: string;
}

/** A running test receiver. */
export interface TestReceiver {
  /** Base URL, `http://127.0.0.1:<port>/` or `https://…`. */
  url: string;
  /** Listening port. */
  port: number;
  /** Requests received so far, in arrival order. */
  requests: TestReceiverRequest[];
  /** Every request received so far, as deliveries. */
  readonly deliveries: readonly TestDelivery[];
  /** Waits for the next delivery matching `predicate` (default 5 s). */
  next(
    predicate?: (d: TestDelivery) => boolean,
    timeoutMs?: number
  ): Promise<TestDelivery>;
  /** Resolves when `count` requests have been received. */
  waitFor(count: number, timeoutMs?: number): Promise<TestReceiverRequest[]>;
  /** Stops listening and drops open connections. */
  close(): Promise<void>;
}

function pick<T>(value: T | T[] | undefined, index: number): T | undefined {
  if (!Array.isArray(value)) return value;
  return value[Math.min(index, value.length - 1)];
}

/**
 * Starts a real HTTP(S) receiver on loopback that records every request and
 * answers from status sequences, delays, echo modes or a 307 redirect.
 *
 * @param options - Fault knobs; all optional.
 * @returns The running receiver; call `close()` when done.
 */
export async function createTestReceiver(
  options: TestReceiverOptions = {}
): Promise<TestReceiver> {
  type Http = {
    createServer(
      listener: (req: IncomingMessage, res: ServerResponse) => void
    ): Server;
  };
  type Https = {
    createServer(
      options: { cert: string; key: string },
      listener: (req: IncomingMessage, res: ServerResponse) => void
    ): Server;
  };
  const requests: TestReceiverRequest[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];
  const deliveries: TestDelivery[] = [];
  const nextWaiters: {
    predicate: (d: TestDelivery) => boolean;
    resolve: (d: TestDelivery) => void;
  }[] = [];
  const statuses = options.statuses ?? [200];

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(req.headers)) {
          if (value !== undefined) {
            headers[name] = Array.isArray(value) ? value.join(", ") : value;
          }
        }
        const servername = (req.socket as Partial<TLSSocket>).servername;
        const recorded: TestReceiverRequest = {
          method: req.method ?? "",
          path: req.url ?? "",
          headers,
          body: Buffer.concat(chunks).toString("utf8"),
          ...(typeof servername === "string" && { servername }),
        };
        const index = requests.length;
        requests.push(recorded);
        let json: unknown;
        try {
          json = JSON.parse(recorded.body);
        } catch {
          json = undefined;
        }
        const delivery: TestDelivery = {
          headers,
          body: recorded.body,
          json,
          at: Date.now(),
        };
        deliveries.push(delivery);
        for (const w of nextWaiters.filter((n) => n.predicate(delivery))) {
          nextWaiters.splice(nextWaiters.indexOf(w), 1);
          w.resolve(delivery);
        }
        for (const waiter of waiters.filter(
          (w) => requests.length >= w.count
        )) {
          waiter.resolve();
        }
        const reply = await reply_(recorded, index);
        const delay = reply.delayMs ?? pick(options.delayMs, index) ?? 0;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        res.writeHead(reply.status ?? 200, {
          ...options.headers,
          ...reply.headers,
        });
        res.end(reply.body ?? "");
      })();
    });
  };

  const reply_ = async (
    request: TestReceiverRequest,
    index: number
  ): Promise<TestReceiverReply> => {
    if (options.respond !== undefined) return options.respond(request, index);
    if (options.redirectTo !== undefined) {
      return { status: 307, headers: { location: options.redirectTo } };
    }
    const status = pick(statuses, index) ?? 200;
    switch (options.echo ?? "none") {
      case "body":
        return { status, body: request.body };
      case "challenge": {
        let challenge: unknown;
        try {
          challenge = (JSON.parse(request.body) as { challenge?: unknown })
            .challenge;
        } catch {
          challenge = undefined;
        }
        return {
          status,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challenge }),
        };
      }
      default:
        return { status };
    }
  };

  const server =
    options.tls === undefined
      ? (await importNodeBuiltin<Http>("http")).createServer(handler)
      : (await importNodeBuiltin<Https>("https")).createServer(
          options.tls,
          handler
        );
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve());
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  const scheme = options.tls === undefined ? "http" : "https";
  return {
    url: `${scheme}://${host.includes(":") ? `[${host}]` : host}:${port}/`,
    port,
    requests,
    deliveries,
    next(predicate = () => true, timeoutMs = 5_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("receiver: no matching delivery")),
          timeoutMs
        );
        nextWaiters.push({
          predicate,
          resolve: (d) => {
            clearTimeout(timer);
            resolve(d);
          },
        });
      });
    },
    waitFor(count, timeoutMs = 5_000) {
      if (requests.length >= count) return Promise.resolve(requests);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`receiver got ${requests.length}/${count}`)),
          timeoutMs
        );
        waiters.push({
          count,
          resolve: () => {
            clearTimeout(timer);
            resolve(requests);
          },
        });
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
