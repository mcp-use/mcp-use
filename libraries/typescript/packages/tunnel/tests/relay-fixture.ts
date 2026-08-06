import { randomUUID } from "node:crypto";
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { WebSocket, WebSocketServer, type RawData } from "ws";

const REQUEST_BODY_FRAME = 1;
const RESPONSE_BODY_FRAME = 2;
const PUBLIC_WEBSOCKET_TEXT_FRAME = 3;
const PUBLIC_WEBSOCKET_BINARY_FRAME = 4;
const LOCAL_WEBSOCKET_TEXT_FRAME = 5;
const LOCAL_WEBSOCKET_BINARY_FRAME = 6;
const REQUEST_ID_BYTES = 36;

interface PendingResponse {
  response: ServerResponse;
}

interface TunnelConnection {
  authenticated: boolean;
  socket: WebSocket;
  publicSockets: Map<string, WebSocket>;
}

function encodeFrame(
  kind: number,
  requestId: string,
  body: Uint8Array
): Buffer {
  return Buffer.concat([
    Buffer.from([kind]),
    Buffer.from(requestId, "ascii"),
    Buffer.from(body),
  ]);
}

function rawDataBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  return Buffer.concat(raw);
}

function decodeFrame(
  raw: Buffer
): { kind: number; requestId: string; body: Buffer } | undefined {
  if (raw.byteLength < 1 + REQUEST_ID_BYTES) return undefined;
  return {
    kind: raw[0] ?? 0,
    requestId: raw.subarray(1, 1 + REQUEST_ID_BYTES).toString("ascii"),
    body: raw.subarray(1 + REQUEST_ID_BYTES),
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Relay fixture did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    server.close((error) => {
      if (error && "code" in error && error.code !== "ERR_SERVER_NOT_RUNNING") {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/** Local relay with the same reservation and binary WebSocket contract as production. */
export async function createRelayFixture(): Promise<{
  relayBase: string;
  deletionCount(): number;
  cancelLocalRequest(path: string): Promise<void>;
  close(): Promise<void>;
}> {
  const tunnelId = "test-tunnel";
  const token = "test-token";
  const pending = new Map<string, PendingResponse>();
  let tunnel: TunnelConnection | undefined;
  let deletions = 0;
  const relaySockets = new WebSocketServer({ noServer: true });

  const server = http.createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? "/", "http://relay.invalid");

      if (
        request.method === "POST" &&
        url.pathname === "/api/tunnels/request"
      ) {
        const port = boundPort();
        response.writeHead(201, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            tunnel_id: tunnelId,
            token,
            connect_url: `ws://127.0.0.1:${port}/connect/${tunnelId}`,
            public_url: `http://127.0.0.1:${port}/t/${tunnelId}`,
          })
        );
        return;
      }

      if (
        request.method === "DELETE" &&
        url.pathname === `/api/tunnels/${tunnelId}`
      ) {
        if (request.headers.authorization !== `Bearer ${token}`) {
          response.writeHead(404).end();
          return;
        }
        deletions += 1;
        tunnel?.socket.close(1000, "deleted");
        tunnel = undefined;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ deleted: true }));
        return;
      }

      const match = url.pathname.match(/^\/t\/test-tunnel(\/.*)?$/);
      if (match === null || tunnel?.authenticated !== true) {
        response.writeHead(404).end();
        return;
      }

      const requestId = randomUUID();
      pending.set(requestId, { response });
      tunnel.socket.send(
        JSON.stringify({
          type: "request-start",
          requestId,
          method: request.method ?? "GET",
          path: `${match[1] ?? "/"}${url.search}`,
          headers: Object.fromEntries(
            Object.entries(request.headers).filter(([name]) => name !== "host")
          ),
        })
      );
      for await (const chunk of request) {
        tunnel.socket.send(
          encodeFrame(REQUEST_BODY_FRAME, requestId, Buffer.from(chunk))
        );
      }
      tunnel.socket.send(JSON.stringify({ type: "request-end", requestId }));
    }
  );

  const boundPort = (): number => {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Relay fixture is not listening");
    }
    return address.port;
  };

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://relay.invalid");
    if (url.pathname === `/connect/${tunnelId}`) {
      relaySockets.handleUpgrade(request, socket, head, (client) => {
        const connection: TunnelConnection = {
          authenticated: false,
          socket: client,
          publicSockets: new Map(),
        };
        tunnel = connection;
        client.send(JSON.stringify({ type: "auth-required" }));
        client.on("message", (raw, isBinary) => {
          if (isBinary) {
            const frame = decodeFrame(rawDataBuffer(raw));
            if (frame === undefined) return;
            const state = pending.get(frame.requestId);
            if (frame.kind === RESPONSE_BODY_FRAME) {
              state?.response.write(frame.body);
            } else if (
              frame.kind === LOCAL_WEBSOCKET_TEXT_FRAME ||
              frame.kind === LOCAL_WEBSOCKET_BINARY_FRAME
            ) {
              connection.publicSockets.get(frame.requestId)?.send(frame.body, {
                binary: frame.kind === LOCAL_WEBSOCKET_BINARY_FRAME,
              });
            }
            return;
          }

          const message = JSON.parse(raw.toString()) as {
            type?: string;
            token?: string;
            requestId?: string;
            status?: number;
            headers?: http.OutgoingHttpHeaders;
            code?: number;
            reason?: string;
          };
          if (message.type === "authenticate") {
            if (message.token !== token) {
              client.close(1008, "Invalid token");
              return;
            }
            connection.authenticated = true;
            client.send(JSON.stringify({ type: "ready" }));
          } else if (message.type === "response-start" && message.requestId) {
            pending
              .get(message.requestId)
              ?.response.writeHead(message.status ?? 502, message.headers);
          } else if (message.type === "response-end" && message.requestId) {
            pending.get(message.requestId)?.response.end();
            pending.delete(message.requestId);
          } else if (message.type === "response-error" && message.requestId) {
            pending.get(message.requestId)?.response.destroy();
            pending.delete(message.requestId);
          } else if (message.type === "websocket-close" && message.requestId) {
            connection.publicSockets
              .get(message.requestId)
              ?.close(message.code, message.reason);
          }
        });
        client.on("close", () => {
          if (tunnel === connection) tunnel = undefined;
          for (const state of pending.values()) state.response.destroy();
          pending.clear();
        });
      });
      return;
    }

    const match = url.pathname.match(/^\/t\/test-tunnel(\/.*)?$/);
    if (match === null || tunnel?.authenticated !== true) {
      socket.destroy();
      return;
    }
    const connection = tunnel;
    relaySockets.handleUpgrade(request, socket, head, (publicSocket) => {
      const requestId = randomUUID();
      connection.publicSockets.set(requestId, publicSocket);
      publicSocket.on("message", (raw, isBinary) => {
        connection.socket.send(
          encodeFrame(
            isBinary
              ? PUBLIC_WEBSOCKET_BINARY_FRAME
              : PUBLIC_WEBSOCKET_TEXT_FRAME,
            requestId,
            rawDataBuffer(raw)
          )
        );
      });
      publicSocket.on("close", (code, reason) => {
        connection.publicSockets.delete(requestId);
        if (connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.send(
            JSON.stringify({
              type: "websocket-close",
              requestId,
              code,
              reason: reason.toString(),
            })
          );
        }
      });
      connection.socket.send(
        JSON.stringify({
          type: "websocket-open",
          requestId,
          path: `${match[1] ?? "/"}${url.search}`,
          protocols: [],
        })
      );
    });
  });

  const port = await listen(server);
  return {
    relayBase: `http://127.0.0.1:${port}`,
    deletionCount: () => deletions,
    async cancelLocalRequest(path: string) {
      if (tunnel?.authenticated !== true) {
        throw new Error("Tunnel fixture is not connected");
      }
      const requestId = randomUUID();
      tunnel.socket.send(
        JSON.stringify({
          type: "request-start",
          requestId,
          method: "GET",
          path,
          headers: {},
        })
      );
      tunnel.socket.send(JSON.stringify({ type: "request-end", requestId }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      tunnel.socket.send(JSON.stringify({ type: "cancel", requestId }));
    },
    async close() {
      tunnel?.socket.terminate();
      for (const client of relaySockets.clients) client.terminate();
      await new Promise<void>((resolve) => relaySockets.close(() => resolve()));
      await closeServer(server);
    },
  };
}
