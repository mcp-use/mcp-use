/**
 * A real HTTP CONNECT egress proxy for tests and local platform emulation
 * (D65, §18): records each CONNECT and the TLS SNI that follows, and can
 * refuse targets or route them elsewhere.
 */

import type { Server, Socket } from "node:net";
import { importNodeBuiltin } from "../../net/pinned.js";

/** One CONNECT recorded by a {@link TestEgressProxy}. */
export interface TestEgressConnect {
  /** The requested authority, exactly as sent (`ip:port` or `[ip]:port`). */
  target: string;
  /** The `Proxy-Authorization` header, if any. */
  authorization?: string;
  /** The status the proxy answered. */
  status: number;
  /** The SNI of the TLS ClientHello sent through the tunnel, if any. */
  servername?: string;
}

/** Options for {@link createTestEgressProxy}. */
export interface TestEgressProxyOptions {
  /**
   * Returns a refusal status (for example 403 or 502) for a target, or
   * `undefined` to allow it.
   */
  refuse?: (target: string) => number | undefined;
  /**
   * Where to connect for an allowed target. Default: the target itself.
   * Lets tests send to a public-looking validated IP and still reach a
   * loopback receiver.
   */
  route?: (target: string) => { host: string; port: number };
  /** Require these credentials (`user:pass`); others get 407. */
  credentials?: string;
}

/** A running test egress proxy. */
export interface TestEgressProxy {
  /** `http://[user:pass@]127.0.0.1:<port>`, for the sender's `proxy`. */
  url: string;
  /** CONNECT requests so far, in arrival order. */
  connects: TestEgressConnect[];
  /** Stops listening and drops tunnels. */
  close(): Promise<void>;
}

/** Extracts the SNI host name from a TLS ClientHello, if present. */
export function readClientHelloServername(
  data: Uint8Array
): string | undefined {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Record header (5) + handshake header (4) + version (2) + random (32).
  if (data.byteLength < 43 || data[0] !== 0x16 || data[5] !== 0x01) {
    return undefined;
  }
  let offset = 43;
  const sessionIdLength = data[offset]!;
  offset += 1 + sessionIdLength;
  if (offset + 2 > data.byteLength) return undefined;
  offset += 2 + view.getUint16(offset);
  if (offset + 1 > data.byteLength) return undefined;
  offset += 1 + data[offset]!;
  if (offset + 2 > data.byteLength) return undefined;
  const extensionsEnd = Math.min(
    data.byteLength,
    offset + 2 + view.getUint16(offset)
  );
  offset += 2;
  while (offset + 4 <= extensionsEnd) {
    const type = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    offset += 4;
    if (type === 0 && offset + 5 <= extensionsEnd) {
      const nameLength = view.getUint16(offset + 3);
      const start = offset + 5;
      return new TextDecoder().decode(data.subarray(start, start + nameLength));
    }
    offset += length;
  }
  return undefined;
}

function parseTarget(target: string): { host: string; port: number } {
  const match = /^\[?([^\]]+?)\]?:(\d+)$/.exec(target);
  if (match === null) return { host: target, port: 443 };
  return { host: match[1]!, port: Number(match[2]) };
}

/**
 * Starts an HTTP CONNECT proxy on loopback that records every CONNECT
 * (target, `Proxy-Authorization`, answered status, SNI), refuses targets
 * on request and tunnels the rest.
 *
 * @param options - Refusal, routing and credential knobs; all optional.
 * @returns The running proxy; call `close()` when done.
 */
export async function createTestEgressProxy(
  options: TestEgressProxyOptions = {}
): Promise<TestEgressProxy> {
  type Net = {
    createServer(listener: (socket: Socket) => void): Server;
    connect(options: { host: string; port: number }): Socket;
  };
  const net = await importNodeBuiltin<Net>("net");
  const connects: TestEgressConnect[] = [];
  const open = new Set<Socket>();
  const expected =
    options.credentials === undefined
      ? undefined
      : `Basic ${btoa(options.credentials)}`;

  const server = net.createServer((client) => {
    open.add(client);
    client.on("close", () => open.delete(client));
    client.on("error", () => client.destroy());
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end === -1) return;
      client.off("data", onData);
      const lines = buffered.subarray(0, end).toString("latin1").split("\r\n");
      const rest = buffered.subarray(end + 4);
      const [method, target = ""] = lines[0]!.split(" ");
      let authorization: string | undefined;
      for (const line of lines.slice(1)) {
        const colon = line.indexOf(":");
        if (
          line.slice(0, colon).trim().toLowerCase() === "proxy-authorization"
        ) {
          authorization = line.slice(colon + 1).trim();
        }
      }
      const record: TestEgressConnect = {
        target,
        ...(authorization !== undefined && { authorization }),
        status: 200,
      };
      connects.push(record);
      const reject = (status: number) => {
        record.status = status;
        client.end(`HTTP/1.1 ${status} Refused\r\ncontent-length: 0\r\n\r\n`);
      };
      if (method !== "CONNECT") return reject(405);
      if (expected !== undefined && authorization !== expected) {
        return reject(407);
      }
      const refusal = options.refuse?.(target);
      if (refusal !== undefined) return reject(refusal);
      const destination = options.route?.(target) ?? parseTarget(target);
      const upstream = net.connect(destination);
      open.add(upstream);
      upstream.on("close", () => open.delete(upstream));
      upstream.on("error", () => {
        if (record.status === 200 && !client.writableEnded) {
          record.status = 502;
          client.end("HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n");
        } else client.destroy();
      });
      upstream.on("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        let sniffed = false;
        const sniff = (data: Buffer) => {
          if (sniffed) return;
          sniffed = true;
          const servername = readClientHelloServername(data);
          if (servername !== undefined) record.servername = servername;
        };
        if (rest.length > 0) {
          sniff(rest);
          upstream.write(rest);
        }
        client.on("data", sniff);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    };
    client.on("data", onData);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  const userinfo =
    options.credentials === undefined
      ? ""
      : `${options.credentials
          .split(":")
          .map((part) => encodeURIComponent(part))
          .join(":")}@`;
  return {
    url: `http://${userinfo}127.0.0.1:${port}`,
    connects,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
