/**
 * `listenForEvents` (PLAN.md §9.4): a local webhook receiver for Node, dev
 * only, optionally exposed through `@mcp-use/tunnel`.
 *
 * @packageDocumentation
 */

import { EventsClientError } from "./types.js";

/** Options of {@link listenForEvents}. */
export interface ListenForEventsOptions {
  /** Port; default 0 (any free port). */
  port?: number;
  /** Expose through `@mcp-use/tunnel` (optional peer dependency). Refused under `NODE_ENV=production`. */
  tunnel?: boolean;
  /** The request handler, usually from `createWebhookHandler`. */
  handler: (r: Request) => Promise<Response>;
}

/** A running local receiver. */
export interface EventsListener {
  /** Public URL (tunnel) or `http://127.0.0.1:<port>`. */
  url: string;
  /** Stop listening. */
  close(): Promise<void>;
}

/**
 * Start a local webhook receiver.
 *
 * @param options - Port, tunnel and handler.
 * @returns The URL and a `close` function.
 * @throws {@link EventsClientError} `TUNNEL_NOT_FOR_PRODUCTION` when `tunnel` is set under `NODE_ENV=production`.
 */
export async function listenForEvents(
  options: ListenForEventsOptions
): Promise<EventsListener> {
  if (options.tunnel && process.env.NODE_ENV === "production") {
    throw new EventsClientError(
      "TUNNEL_NOT_FOR_PRODUCTION",
      "listenForEvents({ tunnel: true }) is for development only"
    );
  }
  const http = await import("node:http");
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }
      const method = req.method ?? "GET";
      const request = new Request(`http://127.0.0.1${req.url ?? "/"}`, {
        method,
        headers,
        ...(method === "GET" || method === "HEAD"
          ? {}
          : { body: Buffer.concat(chunks) }),
      });
      options
        .handler(request)
        .then(async (response) => {
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        })
        .catch(() => {
          res.statusCode = 500;
          res.end();
        });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  let url = `http://127.0.0.1:${port}`;
  let closeTunnel: (() => Promise<void>) | undefined;
  if (options.tunnel) {
    try {
      const mod = (await import(
        /* @vite-ignore */ "@mcp-use/tunnel" as string
      )) as {
        startTunnel?: (o: { port: number }) => Promise<{
          url: string;
          close(): Promise<void>;
        }>;
      };
      if (!mod.startTunnel) throw new Error("startTunnel not exported");
      const t = await mod.startTunnel({ port });
      url = t.url;
      closeTunnel = () => t.close();
    } catch (err) {
      await new Promise<void>((r) => server.close(() => r()));
      throw new Error(
        `listenForEvents({ tunnel: true }) needs @mcp-use/tunnel: ${String(err)}`
      );
    }
  }
  return {
    url,
    async close() {
      await closeTunnel?.();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
