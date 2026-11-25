/**
 * HTTP CONNECT tunnels through an egress proxy (D65). Node.js and Bun only;
 * the builtins are loaded through computed specifiers by the caller.
 *
 * @internal
 */

import type { Socket } from "node:net";
import type { ConnectionOptions, TLSSocket } from "node:tls";

/** @internal A parsed egress proxy URL. */
export interface EgressProxy {
  /** `true` for `https://` proxies (TLS to the proxy itself). */
  tls: boolean;
  /** Proxy host (brackets removed). */
  host: string;
  /** Proxy port. */
  port: number;
  /** `Basic …` value built from the URL's userinfo, if any. */
  authorization?: string;
}

/**
 * @internal Parses `http://[user:pass@]host:port` or `https://…`. Throws on
 * any other form, so a misconfiguration fails at startup.
 */
export function parseEgressProxy(value: string): EgressProxy {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("egress proxy is not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("egress proxy must be an http:// or https:// URL");
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search !== "") {
    throw new Error("egress proxy URL must not have a path or query");
  }
  const tls = url.protocol === "https:";
  const proxy: EgressProxy = {
    tls,
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port === "" ? (tls ? 443 : 80) : Number(url.port),
  };
  if (url.username !== "" || url.password !== "") {
    const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    proxy.authorization = `Basic ${btoa(credentials)}`;
  }
  return proxy;
}

/** @internal The CONNECT authority for an address and port. */
export function connectAuthority(address: string, port: number): string {
  return address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`;
}

/** @internal Thrown when the proxy answers CONNECT with a non-2xx status. */
export class ConnectRefusedError extends Error {
  /** The proxy's status code. */
  readonly status: number;
  /** @param status - The status the proxy answered. */
  constructor(status: number) {
    super(`egress proxy refused CONNECT with ${status}`);
    this.name = "ConnectRefusedError";
    this.status = status;
  }
}

/** @internal The parts of `node:net` and `node:tls` that tunnels use. */
export interface SocketModules {
  /** `net.connect`. */
  connect(options: { host: string; port: number }): Socket;
  /** `tls.connect`. */
  tlsConnect(options: ConnectionOptions): TLSSocket;
}

const MAX_CONNECT_RESPONSE = 8 * 1024;

/**
 * @internal Opens a socket to `proxy` and asks it to `CONNECT` to
 * `authority` (a validated `ip:port`). Resolves with the tunnelled socket
 * once the proxy answers 2xx; rejects with {@link ConnectRefusedError}
 * otherwise. The caller owns timeouts and destroys the socket on abort.
 */
export function openConnectTunnel(
  modules: SocketModules,
  proxy: EgressProxy,
  authority: string,
  onSocket: (socket: Socket) => void
): Promise<Socket> {
  const socket: Socket = proxy.tls
    ? modules.tlsConnect({
        host: proxy.host,
        port: proxy.port,
        servername: proxy.host,
      })
    : modules.connect({ host: proxy.host, port: proxy.port });
  onSocket(socket);
  return new Promise<Socket>((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(
        Object.assign(new Error("egress proxy closed the connection"), {
          code: "ECONNRESET",
        })
      );
    };
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end === -1) {
        if (buffered.length > MAX_CONNECT_RESPONSE) {
          cleanup();
          socket.destroy();
          reject(new ConnectRefusedError(502));
        }
        return;
      }
      cleanup();
      const statusLine = buffered.subarray(0, end).toString("latin1");
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(statusLine)?.[1]);
      if (!(status >= 200 && status < 300)) {
        socket.destroy();
        reject(new ConnectRefusedError(Number.isNaN(status) ? 502 : status));
        return;
      }
      const rest = buffered.subarray(end + 4);
      if (rest.length > 0) socket.unshift(rest);
      resolve(socket);
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
    const headers = [
      `CONNECT ${authority} HTTP/1.1`,
      `Host: ${authority}`,
      ...(proxy.authorization === undefined
        ? []
        : [`Proxy-Authorization: ${proxy.authorization}`]),
      "",
      "",
    ];
    socket.write(headers.join("\r\n"));
  });
}
