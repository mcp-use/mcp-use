/**
 * The Node.js and Bun webhook sender: resolves and checks the callback host,
 * pins the validated address, optionally tunnels through an egress proxy
 * (D65), and never follows redirects (§8.15).
 */

import type { IncomingMessage, RequestOptions, ClientRequest } from "node:http";
import type { Socket } from "node:net";
import type { ConnectionOptions, TLSSocket } from "node:tls";
import {
  ConnectRefusedError,
  connectAuthority,
  openConnectTunnel,
  parseEgressProxy,
  type EgressProxy,
  type SocketModules,
} from "../../net/connect-proxy.js";
import { importNodeBuiltin, isNodeOrBun } from "../../net/pinned.js";
import {
  checkHost,
  defaultHostResolver,
  type HostResolver,
} from "../../net/resolver.js";
import {
  EventsSenderConfigError,
  SENDER_LIMITS,
  parseRetryAfter,
  type WebhookSendErrorCategory,
  type WebhookSender,
} from "./types.js";

/** Options for {@link nodeWebhookSender}. */
export interface NodeWebhookSenderOptions {
  /**
   * Egress proxy URL, `http://[user:pass@]host:port` or `https://…`. Each
   * delivery is sent as `CONNECT <validated-ip>:<port>`, with
   * `Proxy-Authorization` built from the URL's userinfo. Trusted dev origins
   * bypass it. Never installed as a global agent.
   */
  proxy?: string;
  /**
   * @internal Test seam: answers DNS instead of `node:dns`.
   */
  resolve?: HostResolver;
  /**
   * @internal Test seam: extra TLS options for the callback connection
   * (for example a test CA).
   */
  tls?: Pick<ConnectionOptions, "ca" | "rejectUnauthorized">;
  /** @internal Test seam: connect timeout in ms (default 5,000). */
  connectTimeoutMs?: number;
  /** @internal Test seam: total timeout in ms (default 10,000). */
  totalTimeoutMs?: number;
}

interface NodeModules extends SocketModules {
  httpRequest(options: RequestOptions): ClientRequest;
}

let modulesPromise: Promise<NodeModules> | undefined;

function loadModules(): Promise<NodeModules> {
  modulesPromise ??= (async () => {
    type Net = { connect: SocketModules["connect"] };
    type Tls = { connect: SocketModules["tlsConnect"] };
    type Http = { request: NodeModules["httpRequest"] };
    const [net, tls, http] = await Promise.all([
      importNodeBuiltin<Net>("net"),
      importNodeBuiltin<Tls>("tls"),
      importNodeBuiltin<Http>("http"),
    ]);
    return {
      connect: (options) => net.connect(options),
      tlsConnect: (options) => tls.connect(options),
      httpRequest: (options) => http.request(options),
    };
  })();
  return modulesPromise;
}

class SendFailure extends Error {
  constructor(readonly category: WebhookSendErrorCategory) {
    super(category);
  }
}

const TLS_CODES =
  /^(ERR_TLS|ERR_SSL|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_|HOSTNAME_MISMATCH|ERR_OSSL)/;

function categorize(error: unknown): WebhookSendErrorCategory {
  if (error instanceof SendFailure) return error.category;
  if (error instanceof ConnectRefusedError) {
    return error.status === 403 ? "blocked_address" : "connection_refused";
  }
  const code = (error as { code?: unknown } | undefined)?.code;
  if (typeof code === "string") {
    if (code === "ETIMEDOUT" || code === "ABORT_ERR") return "timeout";
    if (TLS_CODES.test(code)) return "tls_error";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns_failure";
  }
  const name = (error as { name?: unknown } | undefined)?.name;
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  return "connection_refused";
}

/** Rejects when `signal` aborts, with a `timeout` failure. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new SendFailure("timeout"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SendFailure("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function waitForEvent(socket: Socket, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off(event, onEvent);
      reject(error);
    };
    const onEvent = () => {
      socket.off("error", onError);
      resolve();
    };
    socket.once(event, onEvent);
    socket.once("error", onError);
  });
}

/**
 * Creates the Node.js and Bun webhook sender (`info().sender` is
 * `"node-pinned"`, or `"node-pinned+proxy"` with a proxy):
 *
 * 1. resolves A and AAAA and refuses special-purpose addresses
 *    (`blocked_address`) and unresolvable hosts (`dns_failure`);
 * 2. pins the first validated address;
 * 3. with a proxy sends `CONNECT <validated-ip>:<port>`, else dials the
 *    address directly; TLS uses the hostname for SNI and certificate checks,
 *    and `Host` is the hostname;
 * 4. never follows redirects (`redirect`), allows 5 s to connect (including
 *    the CONNECT and TLS), 10 s in total, and reads at most 4 KiB of body.
 *
 * Only `https:` callback URLs are sent unless the request is `trusted` (a
 * dev trusted origin), which also skips the address checks and the proxy.
 *
 * @param options - The egress proxy, if any.
 * @returns A sender that never throws for network failures.
 * @throws EventsSenderConfigError (`EVENTS_CONFIG_INVALID`, field
 * `egressProxy`) when the proxy URL is invalid or the runtime is not
 * Node.js or Bun.
 */
export function nodeWebhookSender(
  options: NodeWebhookSenderOptions = {}
): WebhookSender {
  let proxy: EgressProxy | undefined;
  if (options.proxy !== undefined) {
    try {
      proxy = parseEgressProxy(options.proxy);
    } catch (error) {
      throw new EventsSenderConfigError(
        "egressProxy",
        error instanceof Error ? error.message : String(error)
      );
    }
    if (!isNodeOrBun()) {
      throw new EventsSenderConfigError(
        "egressProxy",
        "an egress proxy needs the Node.js or Bun webhook sender"
      );
    }
  }
  const connectTimeoutMs =
    options.connectTimeoutMs ?? SENDER_LIMITS.connectTimeoutMs;
  const totalTimeoutMs = options.totalTimeoutMs ?? SENDER_LIMITS.totalTimeoutMs;

  return async (request) => {
    const sockets: Socket[] = [];
    const total = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(totalTimeoutMs),
    ]);
    const destroyAll = () => {
      for (const socket of sockets) socket.destroy();
    };
    total.addEventListener("abort", destroyAll, { once: true });
    try {
      const url = new URL(request.url);
      const secure = url.protocol === "https:";
      if (!secure && !(request.trusted && url.protocol === "http:")) {
        throw new SendFailure("blocked_address");
      }
      if (url.username !== "" || url.password !== "") {
        throw new SendFailure("blocked_address");
      }
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const port = url.port === "" ? (secure ? 443 : 80) : Number(url.port);
      const modules = await loadModules();

      let address = hostname;
      if (!request.trusted) {
        const resolve = options.resolve ?? (await defaultHostResolver());
        const checked = await abortable(checkHost(hostname, resolve), total);
        if ("refused" in checked) {
          throw new SendFailure(
            checked.refused === "blocked_address"
              ? "blocked_address"
              : "dns_failure"
          );
        }
        address = checked.addresses[0]!;
      }

      const connectSignal = AbortSignal.any([
        total,
        AbortSignal.timeout(connectTimeoutMs),
      ]);
      const onConnectAbort = () => destroyAll();
      connectSignal.addEventListener("abort", onConnectAbort, { once: true });
      let socket: Socket;
      try {
        if (proxy !== undefined && !request.trusted) {
          socket = await abortable(
            openConnectTunnel(
              modules,
              proxy,
              connectAuthority(address, port),
              (raw) => sockets.push(raw)
            ),
            connectSignal
          );
        } else {
          socket = modules.connect({ host: address, port });
          sockets.push(socket);
          await abortable(waitForEvent(socket, "connect"), connectSignal);
        }
        if (secure) {
          const tlsSocket: TLSSocket = modules.tlsConnect({
            ...options.tls,
            socket,
            servername: isIpHost(hostname) ? undefined : hostname,
            host: hostname,
            ALPNProtocols: ["http/1.1"],
          });
          sockets.push(tlsSocket);
          await abortable(
            waitForEvent(tlsSocket, "secureConnect"),
            connectSignal
          );
          socket = tlsSocket;
        }
      } finally {
        connectSignal.removeEventListener("abort", onConnectAbort);
      }

      const response = await abortable(
        post(modules, socket, url, hostname, port, secure, request),
        total
      );
      return response;
    } catch (error) {
      if (total.aborted && !(error instanceof SendFailure)) {
        return { error: "timeout" };
      }
      return { error: categorize(error) };
    } finally {
      total.removeEventListener("abort", destroyAll);
      destroyAll();
    }
  };
}

function isIpHost(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function post(
  modules: NodeModules,
  socket: Socket,
  url: URL,
  hostname: string,
  port: number,
  secure: boolean,
  request: Parameters<WebhookSender>[0]
): Promise<{ status: number; body: string; retryAfterMs?: number }> {
  const defaultPort = secure ? 443 : 80;
  const hostHeader =
    (hostname.includes(":") ? `[${hostname}]` : hostname) +
    (port === defaultPort ? "" : `:${port}`);
  const body = new TextEncoder().encode(request.body);
  return new Promise((resolve, reject) => {
    const outgoing = modules.httpRequest({
      method: "POST",
      path: `${url.pathname}${url.search}`,
      headers: {
        ...request.headers,
        host: hostHeader,
        "content-length": String(body.byteLength),
      },
      createConnection: () => socket,
    } as RequestOptions);
    outgoing.on("error", reject);
    outgoing.on("response", (response: IncomingMessage) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.destroy();
        reject(new SendFailure("redirect"));
        return;
      }
      const retryAfterMs = parseRetryAfter(
        firstHeader(response.headers["retry-after"])
      );
      const chunks: Uint8Array[] = [];
      let length = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve({
          status,
          body: new TextDecoder().decode(bytes),
          ...(retryAfterMs !== undefined && { retryAfterMs }),
        });
      };
      response.on("data", (chunk: Uint8Array) => {
        const room = SENDER_LIMITS.maxResponseBytes - length;
        if (room <= 0) return;
        const part = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
        chunks.push(part);
        length += part.byteLength;
        if (length >= SENDER_LIMITS.maxResponseBytes) {
          finish();
          response.destroy();
        }
      });
      response.on("end", finish);
      response.on("error", () => finish());
      response.on("close", finish);
    });
    outgoing.end(body);
  });
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
