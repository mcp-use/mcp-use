/**
 * The runner's own webhook receiver: a local HTTP listener that answers the
 * verification handshake by echoing only the challenge, records every POST
 * and exposes them through {@link ReceiverHandle}. Node-compatible runtimes
 * only (`node:http`, imported lazily so the package stays runtime-neutral).
 *
 * Paths: `/c/<tag>` accepts; `/fail/<tag>` answers 500 to everything;
 * `/echo/<tag>` answers verification with the whole body (anti-reflection probe).
 *
 * @packageDocumentation
 */

import { CALLBACK_TAG_HEADER } from "./context.js";
import type { ReceivedDelivery, ReceiverHandle } from "./types.js";

/** Options of {@link createSigningReceiver}. */
export interface SigningReceiverOptions {
  /** Interface to bind; default `127.0.0.1`. */
  host?: string;
  /** Port; default an ephemeral port. */
  port?: number;
  /** The public URL the server reaches the receiver at (a tunnel); default the bound address. */
  publicUrl?: string;
}

interface NodeReq {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", cb: (chunk: Uint8Array) => void): void;
  on(event: "end", cb: () => void): void;
}
interface NodeRes {
  writeHead(status: number, headers?: Record<string, string>): NodeRes;
  end(body?: string): void;
}
interface NodeServer {
  once(event: "error", cb: (e: unknown) => void): void;
  listen(port: number, host: string, cb: () => void): void;
  address(): { port: number } | string | null;
  close(cb: () => void): void;
  closeAllConnections?(): void;
}
interface NodeHttp {
  createServer(handler: (req: NodeReq, res: NodeRes) => void): NodeServer;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

type Waiter = {
  pred: (d: ReceivedDelivery) => boolean;
  resolve: (d: ReceivedDelivery) => void;
};

/**
 * Starts a receiver.
 *
 * @param o - Bind address and public URL.
 * @returns The handle.
 */
export async function createSigningReceiver(
  o: SigningReceiverOptions = {}
): Promise<ReceiverHandle> {
  // A variable specifier keeps bundlers and the neutral type surface off `node:http`.
  const specifier = "node:http";
  const http = (await import(specifier)) as NodeHttp;
  const pending: ReceivedDelivery[] = [];
  const waiters: Waiter[] = [];

  const deliver = (d: ReceivedDelivery): void => {
    const i = waiters.findIndex((w) => w.pred(d));
    if (i >= 0) {
      const [w] = waiters.splice(i, 1);
      w?.resolve(d);
    } else {
      pending.push(d);
    }
  };

  const server = http.createServer((req, res) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (c: Uint8Array) => chunks.push(c));
    req.on("end", () => {
      const body = concat(chunks);
      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder().decode(body));
      } catch {
        json = undefined;
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      const m = /^\/(c|fail|echo)\/([^/]+)/.exec(path);
      if (m?.[2]) headers.set(CALLBACK_TAG_HEADER, m[2]);
      deliver({ headers, body, json });
      if (m?.[1] === "fail" || req.method !== "POST") {
        res.writeHead(500).end();
        return;
      }
      const j = json as Record<string, unknown> | undefined;
      if (j?.type === "verification" && m?.[1] === "echo") {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(new TextDecoder().decode(body));
        return;
      }
      if (j?.type === "verification") {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ challenge: j.challenge }));
        return;
      }
      res.writeHead(200).end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port ?? 0, o.host ?? "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : o.port;
  const url = o.publicUrl ?? `http://${o.host ?? "127.0.0.1"}:${port}`;

  return {
    url,
    next(pred, timeoutMs) {
      const i = pending.findIndex(pred);
      if (i >= 0) {
        const [d] = pending.splice(i, 1);
        return Promise.resolve(d as ReceivedDelivery);
      }
      return new Promise((resolve, reject) => {
        const w: Waiter = {
          pred,
          resolve: (d) => {
            clearTimeout(timer);
            resolve(d);
          },
        };
        const timer = setTimeout(() => {
          const k = waiters.indexOf(w);
          if (k >= 0) waiters.splice(k, 1);
          reject(new Error(`no matching delivery within ${timeoutMs} ms`));
        }, timeoutMs);
        waiters.push(w);
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
