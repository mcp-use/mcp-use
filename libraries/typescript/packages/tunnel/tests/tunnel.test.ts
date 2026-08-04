/**
 * Unit tests for the WebSocket tunnel lifecycle.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTunnelManager } from "../src/index.js";

const reservation = {
  tunnel_id: "quiet-amber",
  token: "test-token",
  connect_url: "wss://api.tunnel.test/connect/quiet-amber",
  public_url: "https://quiet-amber.tunnel.test",
};

function closeEvent(code: number, reason: string): CloseEvent {
  const event = new Event("close") as CloseEvent;
  Object.defineProperties(event, {
    code: { value: code },
    reason: { value: reason },
    wasClean: { value: code !== 1006 },
  });
  return event;
}

function messageEvent(data: string): MessageEvent {
  const event = new Event("message") as MessageEvent;
  Object.defineProperty(event, "data", { value: data });
  return event;
}

class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: MockWebSocket[] = [];
  static keepaliveSupported = true;

  readonly sent: string[] = [];
  binaryType = "blob";
  readyState = MockWebSocket.CONNECTING;

  constructor(readonly url: string) {
    super();
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(data: string | ArrayBuffer): void {
    if (typeof data !== "string") return;
    this.sent.push(data);
    const message = JSON.parse(data) as { type?: string };
    if (message.type === "authenticate") {
      queueMicrotask(() => {
        this.dispatchEvent(
          messageEvent(
            JSON.stringify({
              type: "ready",
              ...(MockWebSocket.keepaliveSupported && { keepalive: true }),
            })
          )
        );
      });
    } else if (message.type === "ping") {
      queueMicrotask(() => {
        this.dispatchEvent(messageEvent(JSON.stringify({ type: "pong" })));
      });
    }
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(closeEvent(code, reason));
  }

  disconnect(code = 1012, reason = "Relay restart"): void {
    this.close(code, reason);
  }
}

describe("createTunnelManager", () => {
  let stateFilePath: string;
  let createRequests: number;
  let deleteRequests: number;
  let requestUrl: string | undefined;
  let requestBody: string | undefined;

  beforeEach(() => {
    stateFilePath = join(
      mkdtempSync(join(tmpdir(), "mcp-use-tunnel-test-")),
      "tunnel.json"
    );
    createRequests = 0;
    deleteRequests = 0;
    requestUrl = undefined;
    requestBody = undefined;
    MockWebSocket.instances.length = 0;
    MockWebSocket.keepaliveSupported = true;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          deleteRequests += 1;
          return Response.json({ deleted: true });
        }
        createRequests += 1;
        requestUrl = input instanceof Request ? input.url : input.toString();
        requestBody = typeof init?.body === "string" ? init.body : undefined;
        return Response.json(reservation, { status: 201 });
      })
    );
  });

  it("uses the configured relay and requested subdomain", async () => {
    const tunnel = createTunnelManager(stateFilePath, {
      relayUrl: "https://relay.example.com/base",
      subdomain: "preferred-name",
    });
    await tunnel.start(3000);

    expect(requestUrl).toBe("https://relay.example.com/api/tunnels/request");
    expect(requestBody).toBe(JSON.stringify({ subdomain: "preferred-name" }));

    await tunnel.stop();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reattaches the same reservation after a deployment disconnect", async () => {
    const tunnel = createTunnelManager(stateFilePath);
    await expect(tunnel.start(3000)).resolves.toEqual({
      url: reservation.public_url,
      subdomain: reservation.tunnel_id,
    });

    MockWebSocket.instances[0]?.disconnect();

    await vi.waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(tunnel.status().url).toBe(reservation.public_url);
    });
    expect(createRequests).toBe(1);
    expect(deleteRequests).toBe(0);
    expect(MockWebSocket.instances[1]?.url).toBe(reservation.connect_url);

    await tunnel.stop();
    expect(deleteRequests).toBe(1);
  });

  it("keeps an idle relay connection alive with ping and pong", async () => {
    vi.useFakeTimers();
    const tunnel = createTunnelManager(stateFilePath);
    await tunnel.start(3000);

    await vi.advanceTimersByTimeAsync(25_000);

    expect(MockWebSocket.instances[0]?.sent).toContain(
      JSON.stringify({ type: "ping" })
    );
    expect(tunnel.status().url).toBe(reservation.public_url);

    await tunnel.stop();
  });

  it("does not send keepalives to a relay that did not negotiate them", async () => {
    vi.useFakeTimers();
    MockWebSocket.keepaliveSupported = false;
    const tunnel = createTunnelManager(stateFilePath);
    await tunnel.start(3000);

    await vi.advanceTimersByTimeAsync(50_000);

    expect(MockWebSocket.instances[0]?.sent).not.toContain(
      JSON.stringify({ type: "ping" })
    );
    expect(tunnel.status().url).toBe(reservation.public_url);

    await tunnel.stop();
  });
});
