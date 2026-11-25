/**
 * `events/stream` through the tunnel (WP-27, PLAN §11.2): Server-Sent Events
 * must reach the public client frame by frame, not after the response ends,
 * and closing the public request must close the local stream.
 */
import { mkdtempSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

/** Read from `reader` until the decoded text contains `marker`. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(marker)) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("events/stream SSE through the tunnel", () => {
  let local: http.Server;
  let relay: Awaited<ReturnType<typeof createRelayFixture>>;
  let tunnel: TunnelManager;
  let publicUrl: string;
  /** Resolves the second SSE frame; the local stream waits on it. */
  let releaseSecond: () => void;
  let secondReleased: Promise<void>;
  let lastEventId: string | undefined;
  let localClosed: Promise<void>;

  beforeEach(async () => {
    secondReleased = new Promise((resolve) => {
      releaseSecond = resolve;
    });
    let markClosed: () => void = () => {};
    localClosed = new Promise((resolve) => {
      markClosed = resolve;
    });
    local = http.createServer((request, response) => {
      if (request.url !== "/mcp") {
        response.writeHead(404).end();
        return;
      }
      lastEventId = request.headers["last-event-id"] as string | undefined;
      request.resume();
      response.once("close", () => markClosed());
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write(
        'id: 1\nevent: message\ndata: {"jsonrpc":"2.0","method":"notifications/events/active"}\n\n'
      );
      void secondReleased.then(() => {
        if (!response.writableEnded) {
          response.write(
            'id: 2\nevent: message\ndata: {"jsonrpc":"2.0","method":"notifications/events/event"}\n\n'
          );
        }
      });
    });
    const localPort = await listen(local);
    relay = await createRelayFixture();
    tunnel = createTunnelManager(
      join(mkdtempSync(join(tmpdir(), "mcp-use-tunnel-sse-")), "tunnel.json"),
      { relayUrl: relay.relayBase }
    );
    ({ url: publicUrl } = await tunnel.start(localPort));
  });

  afterEach(async () => {
    releaseSecond();
    await tunnel.stop();
    await relay.close();
    await closeServer(local);
  });

  it("delivers each frame before the stream ends and forwards Last-Event-ID", async () => {
    const controller = new AbortController();
    const response = await fetch(`${publicUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
        "last-event-id": "cursor-41",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "events/stream" }),
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(lastEventId).toBe("cursor-41");

    const reader = response.body!.getReader();
    // The second frame is only written after the first one arrived here, so
    // reading it proves the tunnel does not buffer the response.
    const first = await readUntil(reader, "\n\n");
    expect(first).toBe(
      'id: 1\nevent: message\ndata: {"jsonrpc":"2.0","method":"notifications/events/active"}\n\n'
    );
    releaseSecond();
    const second = await readUntil(reader, "\n\n");
    expect(second).toBe(
      'id: 2\nevent: message\ndata: {"jsonrpc":"2.0","method":"notifications/events/event"}\n\n'
    );

    controller.abort();
    await reader.cancel().catch(() => {});
    await expect(localClosed).resolves.toBeUndefined();
  });
});
