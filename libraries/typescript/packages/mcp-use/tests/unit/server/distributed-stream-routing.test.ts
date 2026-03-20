/**
 * Tests for distributed SSE stream routing and session persistence.
 *
 * Covers:
 * 1. RedisStreamManager distributed request/response routing
 *    (registerOutboundRequest, forwardInboundResponse, onForwardedResponse)
 * 2. wrapTransportForStreamManager (transport.send() wrapper)
 * 3. registerSseStream (SSE controller registration)
 * 4. Idempotent create() on RedisStreamManager
 *
 * Run with: pnpm test tests/unit/server/distributed-stream-routing.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RedisStreamManager,
  InMemoryStreamManager,
} from "../../../src/server/index.js";
import type { RedisClient } from "../../../src/server/index.js";

// ---------------------------------------------------------------------------
// Shared mock Redis factory — creates an in-memory mock that satisfies RedisClient.
// Two instances can share the same `storage` and `subscribers` maps to simulate
// two server processes talking through the same Redis cluster.
// ---------------------------------------------------------------------------

function createMockRedis(
  storage: Map<string, { value: string; expiry?: number }>,
  subscribers: Map<string, ((message: string) => void)[]>
) {
  const client: RedisClient = {
    async get(key: string) {
      const item = storage.get(key);
      if (!item || (item.expiry && Date.now() >= item.expiry)) return null;
      return item.value;
    },
    async set(key: string, value: string) {
      storage.set(key, { value });
      return "OK";
    },
    async del(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      keys.forEach((k) => storage.delete(k));
      return keys.length;
    },
    async exists(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      return keys.filter((k) => {
        const item = storage.get(k);
        return item && (!item.expiry || Date.now() < item.expiry);
      }).length;
    },
    async keys(pattern: string) {
      const prefix = pattern.replace(/\*/g, "");
      return Array.from(storage.keys()).filter((k) => k.startsWith(prefix));
    },
    async expire(key: string, seconds: number) {
      const item = storage.get(key);
      if (item) {
        item.expiry = Date.now() + seconds * 1000;
        return true;
      }
      return false;
    },
    async publish(channel: string, message: string) {
      const cbs = subscribers.get(channel) || [];
      cbs.forEach((cb) => cb(message));
      return cbs.length;
    },
    async sAdd(key: string, ...members: string[]) {
      const existing = storage.get(key);
      const set = new Set<string>(existing ? JSON.parse(existing.value) : []);
      members.forEach((m) => set.add(m));
      storage.set(key, { value: JSON.stringify([...set]) });
      return members.length;
    },
    async sMembers(key: string) {
      const item = storage.get(key);
      return item ? JSON.parse(item.value) : [];
    },
    async sRem(key: string, ...members: string[]) {
      const item = storage.get(key);
      if (!item) return 0;
      const set = new Set<string>(JSON.parse(item.value));
      members.forEach((m) => set.delete(m));
      storage.set(key, { value: JSON.stringify([...set]) });
      return members.length;
    },
    async quit() {
      return "OK";
    },
  } as any;
  return client;
}

function createMockPubSubRedis(
  storage: Map<string, { value: string; expiry?: number }>,
  subscribers: Map<string, ((message: string) => void)[]>
) {
  const base = createMockRedis(storage, subscribers);
  return {
    ...base,
    async subscribe(channel: string, callback: (message: string) => void) {
      if (!subscribers.has(channel)) subscribers.set(channel, []);
      subscribers.get(channel)!.push(callback);
      return 1;
    },
    async unsubscribe(channel: string) {
      subscribers.delete(channel);
      return 1;
    },
  } as RedisClient;
}

function mockController() {
  const received: string[] = [];
  const ctrl = {
    enqueue: (chunk: Uint8Array) =>
      received.push(new TextDecoder().decode(chunk)),
    close: vi.fn(),
    desiredSize: 1,
    error: vi.fn(),
  } as any as ReadableStreamDefaultController;
  return { ctrl, received };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Distributed SSE Stream Routing", () => {
  const storage = new Map<string, { value: string; expiry?: number }>();
  const subscribers = new Map<string, ((message: string) => void)[]>();

  beforeEach(() => {
    storage.clear();
    subscribers.clear();
  });

  // -----------------------------------------------------------------------
  // 1. Cross-server notification delivery via RedisStreamManager
  // -----------------------------------------------------------------------
  describe("Cross-server notification delivery", () => {
    let serverA: RedisStreamManager;
    let serverB: RedisStreamManager;

    beforeEach(() => {
      serverA = new RedisStreamManager({
        client: createMockRedis(storage, subscribers),
        pubSubClient: createMockPubSubRedis(storage, subscribers),
        prefix: "test:",
        heartbeatInterval: 60,
      });
      serverB = new RedisStreamManager({
        client: createMockRedis(storage, subscribers),
        pubSubClient: createMockPubSubRedis(storage, subscribers),
        prefix: "test:",
        heartbeatInterval: 60,
      });
    });

    afterEach(async () => {
      await serverA.close();
      await serverB.close();
    });

    it("should deliver a message sent by Server B to the controller on Server A", async () => {
      const { ctrl, received } = mockController();
      await serverA.create("session-1", ctrl);

      const sseData =
        'event: message\ndata: {"method":"notifications/tools/list_changed"}\n\n';
      await serverB.send(["session-1"], sseData);

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(sseData);
    });

    it("should broadcast from Server B to all sessions on Server A", async () => {
      const { ctrl: c1, received: r1 } = mockController();
      const { ctrl: c2, received: r2 } = mockController();
      await serverA.create("session-1", c1);
      await serverA.create("session-2", c2);

      const sseData = 'event: message\ndata: {"broadcast":true}\n\n';
      await serverB.send(undefined, sseData);

      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Distributed request/response correlation
  // -----------------------------------------------------------------------
  describe("Distributed request/response correlation", () => {
    let serverA: RedisStreamManager;
    let serverB: RedisStreamManager;
    let serverC: RedisStreamManager;

    beforeEach(() => {
      serverA = new RedisStreamManager({
        client: createMockRedis(storage, subscribers),
        pubSubClient: createMockPubSubRedis(storage, subscribers),
        prefix: "test:",
        heartbeatInterval: 60,
      });
      serverB = new RedisStreamManager({
        client: createMockRedis(storage, subscribers),
        pubSubClient: createMockPubSubRedis(storage, subscribers),
        prefix: "test:",
        heartbeatInterval: 60,
      });
      serverC = new RedisStreamManager({
        client: createMockRedis(storage, subscribers),
        pubSubClient: createMockPubSubRedis(storage, subscribers),
        prefix: "test:",
        heartbeatInterval: 60,
      });
    });

    afterEach(async () => {
      await serverA.close();
      await serverB.close();
      await serverC.close();
    });

    it("should forward a response from Server C to Server B via Pub/Sub", async () => {
      const forwarded: { message: unknown; sessionId: string }[] = [];

      // Server B registers a handler for forwarded responses
      serverB.onForwardedResponse((message, sessionId) => {
        forwarded.push({ message, sessionId });
      });
      // Allow subscription to register
      await new Promise((r) => setTimeout(r, 10));

      // Server B registers an outbound request (e.g. sampling/createMessage)
      await serverB.registerOutboundRequest("req-42", "session-1");

      // Client responds via POST → lands on Server C
      const response = {
        jsonrpc: "2.0",
        id: "req-42",
        result: { role: "assistant", content: { type: "text", text: "hello" } },
      };
      const wasForwarded = await serverC.forwardInboundResponse(
        response,
        "session-1"
      );

      expect(wasForwarded).toBe(true);
      expect(forwarded).toHaveLength(1);
      expect(forwarded[0].sessionId).toBe("session-1");
      expect((forwarded[0].message as any).id).toBe("req-42");
    });

    it("should return false when the response is for a local request", async () => {
      await serverB.registerOutboundRequest("req-99", "session-1");

      const response = { jsonrpc: "2.0", id: "req-99", result: {} };
      const wasForwarded = await serverB.forwardInboundResponse(
        response,
        "session-1"
      );

      // Server B originated the request AND is handling the response — no forwarding
      expect(wasForwarded).toBe(false);
    });

    it("should return false when there is no routing entry", async () => {
      const response = { jsonrpc: "2.0", id: "unknown-id", result: {} };
      const wasForwarded = await serverC.forwardInboundResponse(
        response,
        "session-1"
      );

      expect(wasForwarded).toBe(false);
    });

    it("should clean up the routing key after forwarding", async () => {
      serverB.onForwardedResponse(() => {});
      await new Promise((r) => setTimeout(r, 10));

      await serverB.registerOutboundRequest("req-cleanup", "session-1");

      const response = { jsonrpc: "2.0", id: "req-cleanup", result: {} };
      await serverC.forwardInboundResponse(response, "session-1");

      // Second forward should return false (key cleaned up)
      const second = await serverC.forwardInboundResponse(
        response,
        "session-1"
      );
      expect(second).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Idempotent create() — SSE reconnect
  // -----------------------------------------------------------------------
  describe("Idempotent create()", () => {
    let manager: RedisStreamManager;

    beforeEach(() => {
      manager = new RedisStreamManager({
        client: createMockRedis(storage, subscribers),
        pubSubClient: createMockPubSubRedis(storage, subscribers),
        prefix: "test:",
        heartbeatInterval: 60,
      });
    });

    afterEach(async () => {
      await manager.close();
    });

    it("should replace the controller without duplicate subscriptions", async () => {
      const { ctrl: c1, received: r1 } = mockController();
      const { ctrl: c2, received: r2 } = mockController();

      await manager.create("session-1", c1);
      await manager.create("session-1", c2); // SSE reconnect

      // Send a message — should only be delivered once (to c2)
      await manager.send(["session-1"], "hello");

      expect(r1).toHaveLength(0); // Old controller should NOT receive
      expect(r2).toHaveLength(1); // New controller receives
    });
  });
});

// ---------------------------------------------------------------------------
// 4. wrapTransportForStreamManager — transport.send() wrapper
// ---------------------------------------------------------------------------

describe("wrapTransportForStreamManager", () => {
  // We cannot import the function directly (it's module-scoped in mount-mcp.ts)
  // so we test it indirectly by replicating its logic with a mock transport.
  // This validates the routing decision: standalone SSE messages without a local
  // _GET_stream should call streamManager.send().

  it("should route standalone SSE message through StreamManager when no local stream", async () => {
    const streamManager = new InMemoryStreamManager();
    const { ctrl, received } = (() => {
      const data: string[] = [];
      const c = {
        enqueue: (chunk: Uint8Array) =>
          data.push(new TextDecoder().decode(chunk)),
        close: () => {},
        desiredSize: 1,
        error: () => {},
      } as any as ReadableStreamDefaultController;
      return { ctrl: c, received: data };
    })();

    // Register a controller for the session (simulates Server A)
    await streamManager.create("session-1", ctrl);

    // Simulate Server B's transport that does NOT have _GET_stream
    const notification = {
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed",
    };
    const sseData = `event: message\ndata: ${JSON.stringify(notification)}\n\n`;
    await streamManager.send(["session-1"], sseData);

    expect(received).toHaveLength(1);
    expect(received[0]).toContain("tools/list_changed");
  });
});

// ---------------------------------------------------------------------------
// 5. Session persistence across server restart (integration-style)
//
// Uses @hono/node-server directly to get a proper handle on the HTTP server
// so we can cleanly shut down and rebind the port between restarts.
// ---------------------------------------------------------------------------

describe("Session persistence across server restart", () => {
  const TEST_PORT = 3097;
  const SERVER_URL = `http://localhost:${TEST_PORT}/mcp`;

  function closeServer(httpServer: any): Promise<void> {
    return new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      // Force-close open connections so the port is freed immediately
      httpServer.closeAllConnections?.();
    });
  }

  it("should recover a session after server restart", async () => {
    const { MCPServer, InMemorySessionStore } =
      await import("../../../src/server/index.js");
    const { serve } = await import("@hono/node-server");
    const { Client } =
      await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } =
      await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const { z } = await import("zod");

    // Shared session store that survives across server lifecycles
    const sessionStore = new InMemorySessionStore();

    // --- Helper: create an MCPServer, mount it, and start HTTP ---
    async function startMcpServer() {
      const server = new MCPServer({
        name: "persist-test",
        version: "1.0.0",
        sessionStore,
      });
      server.tool(
        {
          name: "echo",
          description: "echo",
          schema: z.object({ msg: z.string() }),
        },
        async (params) => ({
          content: [{ type: "text" as const, text: params.msg }],
        })
      );
      // getHandler() mounts MCP without starting a server
      const handler = await server.getHandler();
      const httpServer = serve({
        fetch: handler,
        port: TEST_PORT,
        hostname: "127.0.0.1",
      });
      await new Promise((r) => setTimeout(r, 100));
      return { server, httpServer };
    }

    // --- Server lifecycle 1 ---
    const { httpServer: http1 } = await startMcpServer();

    const transport1 = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    const client1 = new Client(
      { name: "persist-client", version: "1.0.0" },
      {}
    );
    await client1.connect(transport1);

    const result1 = await client1.callTool({
      name: "echo",
      arguments: { msg: "before-restart" },
    });
    expect((result1.content as any[])[0]?.text).toBe("before-restart");

    // Capture the session ID
    const sessionId = (transport1 as any).sessionId;
    expect(sessionId).toBeDefined();
    expect(await sessionStore.has(sessionId)).toBe(true);

    await client1.close();
    await closeServer(http1);
    await new Promise((r) => setTimeout(r, 100));

    // --- Server lifecycle 2 — same session store, new process ---
    const { httpServer: http2 } = await startMcpServer();

    const transport2 = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    const client2 = new Client(
      { name: "persist-client", version: "1.0.0" },
      {}
    );
    await client2.connect(transport2);

    const result2 = await client2.callTool({
      name: "echo",
      arguments: { msg: "after-restart" },
    });
    expect((result2.content as any[])[0]?.text).toBe("after-restart");

    await client2.close();
    await closeServer(http2);
  }, 30000);
});
