import { mkdtempSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { createTunnelManager, type TunnelManager } from "../src/index.js";
import { createRelayFixture } from "./relay-fixture.js";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Local fixture did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function rawDataBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  return Buffer.concat(raw);
}

function webSocketExchange(
  url: string,
  payload: string | Buffer
): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("error", reject);
    socket.once("open", () => socket.send(payload));
    socket.once("message", (message, isBinary) => {
      socket.close();
      resolve(isBinary ? rawDataBuffer(message) : message.toString());
    });
  });
}

describe("WebSocket tunnel end to end", () => {
  let local: http.Server;
  let localSockets: WebSocketServer;
  let relay: Awaited<ReturnType<typeof createRelayFixture>>;
  let tunnel: TunnelManager;
  let publicUrl: string;
  let cancelled: Promise<void>;

  beforeEach(async () => {
    let resolveCancelled: (() => void) | undefined;
    cancelled = new Promise((resolve) => {
      resolveCancelled = resolve;
    });
    local = http.createServer(async (request, response) => {
      if (request.url === "/cancel") {
        request.once("close", () => resolveCancelled?.());
        return;
      }
      if (request.url === "/stream") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.write("first\n");
        setTimeout(() => response.end("second\n"), 20);
        return;
      }
      if (request.url?.startsWith("/concurrent/")) {
        setTimeout(() => response.end(request.url), 5);
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      if (request.url === "/mcp") {
        const message = JSON.parse(body) as { id: unknown };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { ok: true },
          })
        );
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "x-local": "yes",
      });
      response.end(
        JSON.stringify({ method: request.method, path: request.url, body })
      );
    });
    localSockets = new WebSocketServer({ noServer: true });
    local.on("upgrade", (request, socket, head) => {
      if (request.url !== "/socket") {
        socket.destroy();
        return;
      }
      localSockets.handleUpgrade(request, socket, head, (client) => {
        client.on("message", (message, isBinary) => {
          client.send(isBinary ? rawDataBuffer(message) : `echo:${message}`, {
            binary: isBinary,
          });
        });
      });
    });

    const localPort = await listen(local);
    relay = await createRelayFixture();
    const statePath = join(
      mkdtempSync(join(tmpdir(), "mcp-use-tunnel-e2e-")),
      "tunnel.json"
    );
    tunnel = createTunnelManager(statePath, { relayUrl: relay.relayBase });
    ({ url: publicUrl } = await tunnel.start(localPort));
  });

  afterEach(async () => {
    await tunnel.stop();
    for (const socket of localSockets.clients) socket.terminate();
    await new Promise<void>((resolve) => localSockets.close(() => resolve()));
    await relay.close();
    await closeServer(local);
  });

  it("forwards HTTP, MCP JSON-RPC, streaming, and concurrent requests", async () => {
    const response = await fetch(`${publicUrl}/echo?value=1`, {
      method: "POST",
      body: "hello",
    });
    expect(response.headers.get("x-local")).toBe("yes");
    await expect(response.json()).resolves.toEqual({
      method: "POST",
      path: "/echo?value=1",
      body: "hello",
    });

    const mcp = await fetch(`${publicUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
    });
    await expect(mcp.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });

    await expect(
      fetch(`${publicUrl}/stream`).then((value) => value.text())
    ).resolves.toBe("first\nsecond\n");
    await expect(
      Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          fetch(`${publicUrl}/concurrent/${index}`).then((value) =>
            value.text()
          )
        )
      )
    ).resolves.toEqual(
      Array.from({ length: 8 }, (_, index) => `/concurrent/${index}`)
    );
  });

  it("forwards public WebSocket text and binary messages bidirectionally", async () => {
    const wsUrl = `${publicUrl.replace("http://", "ws://")}/socket`;
    await expect(webSocketExchange(wsUrl, "hello")).resolves.toBe("echo:hello");
    await expect(
      webSocketExchange(wsUrl, Buffer.from([1, 2, 3]))
    ).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it("releases the authenticated reservation during graceful shutdown", async () => {
    await tunnel.stop();
    expect(relay.deletionCount()).toBe(1);
  });

  it("cancels and cleans up an in-flight local request", async () => {
    await relay.cancelLocalRequest("/cancel");
    await expect(cancelled).resolves.toBeUndefined();
  });
});
