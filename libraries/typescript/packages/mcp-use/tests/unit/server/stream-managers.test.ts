/**
 * Tests for Stream Manager implementations
 *
 * Tests both InMemoryStreamManager and RedisStreamManager
 * Run with: pnpm test tests/unit/server/stream-managers.test.ts
 * Run with Redis: infisical run --env=dev --projectId=13272018-648f-41fd-911c-908a27c9901e -- pnpm test tests/unit/server/stream-managers.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  InMemoryStreamManager,
  RedisStreamManager,
} from "../../../src/server/index.js";
import type { RedisClient } from "../../../src/server/index.js";

describe("InMemoryStreamManager", () => {
  let manager: InMemoryStreamManager;
  let mockController: ReadableStreamDefaultController;
  let enqueuedData: Uint8Array[] = [];

  beforeEach(() => {
    manager = new InMemoryStreamManager();
    enqueuedData = [];

    // Create mock controller
    mockController = {
      enqueue: (chunk: Uint8Array) => {
        enqueuedData.push(chunk);
      },
      close: () => {},
      desiredSize: 1,
      error: () => {},
    } as any;
  });

  afterEach(async () => {
    await manager.close();
  });

  describe("Basic Operations", () => {
    it("should start empty", async () => {
      expect(manager.size).toBe(0);
      expect(await manager.has("session-1")).toBe(false);
    });

    it("should create and track streams", async () => {
      await manager.create("session-1", mockController);

      expect(await manager.has("session-1")).toBe(true);
      expect(manager.size).toBe(1);
    });

    it("should delete streams", async () => {
      await manager.create("session-1", mockController);
      expect(await manager.has("session-1")).toBe(true);

      await manager.delete("session-1");
      expect(await manager.has("session-1")).toBe(false);
      expect(manager.size).toBe(0);
    });

    it("should handle multiple streams", async () => {
      const controller2 = { ...mockController, enqueue: () => {} } as any;
      const controller3 = { ...mockController, enqueue: () => {} } as any;

      await manager.create("session-1", mockController);
      await manager.create("session-2", controller2);
      await manager.create("session-3", controller3);

      expect(manager.size).toBe(3);
      expect(await manager.has("session-1")).toBe(true);
      expect(await manager.has("session-2")).toBe(true);
      expect(await manager.has("session-3")).toBe(true);
    });
  });

  describe("Sending Data", () => {
    beforeEach(async () => {
      await manager.create("session-1", mockController);
    });

    it("should send data to specific session", async () => {
      const data = 'event: message\ndata: {"test": "data"}\n\n';
      await manager.send(["session-1"], data);

      expect(enqueuedData).toHaveLength(1);
      const decoded = new TextDecoder().decode(enqueuedData[0]);
      expect(decoded).toBe(data);
    });

    it("should send data to multiple sessions", async () => {
      const data2: Uint8Array[] = [];
      const controller2 = {
        ...mockController,
        enqueue: (chunk: Uint8Array) => data2.push(chunk),
      } as any;

      await manager.create("session-2", controller2);

      const message = 'event: notification\ndata: {"type": "test"}\n\n';
      await manager.send(["session-1", "session-2"], message);

      expect(enqueuedData).toHaveLength(1);
      expect(data2).toHaveLength(1);

      const decoded1 = new TextDecoder().decode(enqueuedData[0]);
      const decoded2 = new TextDecoder().decode(data2[0]);
      expect(decoded1).toBe(message);
      expect(decoded2).toBe(message);
    });

    it("should broadcast to all sessions when sessionIds is undefined", async () => {
      const data2: Uint8Array[] = [];
      const data3: Uint8Array[] = [];

      const controller2 = {
        ...mockController,
        enqueue: (chunk: Uint8Array) => data2.push(chunk),
      } as any;

      const controller3 = {
        ...mockController,
        enqueue: (chunk: Uint8Array) => data3.push(chunk),
      } as any;

      await manager.create("session-2", controller2);
      await manager.create("session-3", controller3);

      const message = 'event: broadcast\ndata: {"all": true}\n\n';
      await manager.send(undefined, message);

      expect(enqueuedData).toHaveLength(1);
      expect(data2).toHaveLength(1);
      expect(data3).toHaveLength(1);
    });

    it("should handle send to non-existent session gracefully", async () => {
      await manager.send(["nonexistent"], "test data");
      // Should not throw, just skip
    });
  });

  describe("Cleanup", () => {
    it("should close all streams on close()", async () => {
      const closedSessions: string[] = [];
      const controller1 = {
        ...mockController,
        close: () => closedSessions.push("session-1"),
      } as any;

      const controller2 = {
        ...mockController,
        close: () => closedSessions.push("session-2"),
      } as any;

      await manager.create("session-1", controller1);
      await manager.create("session-2", controller2);

      await manager.close();

      expect(closedSessions).toHaveLength(2);
      expect(manager.size).toBe(0);
    });
  });
});

describe("RedisStreamManager", () => {
  const REDIS_AVAILABLE = process.env.REDIS_URL || process.env.REDISHOST;

  if (!REDIS_AVAILABLE) {
    it.skip("Redis tests skipped - no Redis configuration found", () => {});
    return;
  }

  describe("Mock Redis Tests", () => {
    let manager: RedisStreamManager;
    let mockRedis: RedisClient;
    let mockPubSubRedis: RedisClient;
    const subscribers = new Map<string, ((message: string) => void)[]>();
    const storage = new Map<string, { value: string; expiry?: number }>();

    beforeEach(() => {
      subscribers.clear();
      storage.clear();

      // Mock Redis client
      mockRedis = {
        async get(key: string) {
          const item = storage.get(key);
          if (!item || (item.expiry && Date.now() >= item.expiry)) {
            return null;
          }
          return item.value;
        },
        async set(key: string, value: string) {
          storage.set(key, { value });
          return "OK";
        },
        async setex(key: string, seconds: number, value: string) {
          const expiry = Date.now() + seconds * 1000;
          storage.set(key, { value, expiry });
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
          const channelSubscribers = subscribers.get(channel) || [];
          channelSubscribers.forEach((callback) => callback(message));
          return channelSubscribers.length;
        },
        async quit() {
          return "OK";
        },
      } as any;

      // Mock Pub/Sub client
      mockPubSubRedis = {
        ...mockRedis,
        async subscribe(channel: string, callback: (message: string) => void) {
          if (!subscribers.has(channel)) {
            subscribers.set(channel, []);
          }
          subscribers.get(channel)!.push(callback);
          return 1;
        },
        async unsubscribe(channel: string) {
          subscribers.delete(channel);
          return 1;
        },
        async publish(channel: string, message: string) {
          const channelSubscribers = subscribers.get(channel) || [];
          channelSubscribers.forEach((callback) => callback(message));
          return channelSubscribers.length;
        },
      } as any;

      manager = new RedisStreamManager({
        client: mockRedis,
        pubSubClient: mockPubSubRedis,
        prefix: "test:stream:",
        heartbeatInterval: 1, // 1 second for tests
      });
    });

    afterEach(async () => {
      await manager.close();
    });

    it("should create stream and subscribe to Redis channel", async () => {
      const mockController = {
        enqueue: () => {},
        close: () => {},
      } as any;

      await manager.create("session-1", mockController);

      expect(await manager.has("session-1")).toBe(true);
      expect(manager.localSize).toBe(1);

      // Check Redis key was set
      const availableKey = "available:test:stream:session-1";
      expect(await mockRedis.get(availableKey)).toBe("active");
    });

    it("should send data via Redis Pub/Sub", async () => {
      const receivedData: string[] = [];
      const mockController = {
        enqueue: (chunk: Uint8Array) => {
          receivedData.push(new TextDecoder().decode(chunk));
        },
        close: () => {},
      } as any;

      await manager.create("session-1", mockController);

      const message = 'event: test\ndata: {"hello": "world"}\n\n';
      await manager.send(["session-1"], message);

      expect(receivedData).toHaveLength(1);
      expect(receivedData[0]).toBe(message);
    });

    it("should broadcast to all sessions", async () => {
      const data1: string[] = [];
      const data2: string[] = [];

      const controller1 = {
        enqueue: (chunk: Uint8Array) =>
          data1.push(new TextDecoder().decode(chunk)),
        close: () => {},
      } as any;

      const controller2 = {
        enqueue: (chunk: Uint8Array) =>
          data2.push(new TextDecoder().decode(chunk)),
        close: () => {},
      } as any;

      await manager.create("session-1", controller1);
      await manager.create("session-2", controller2);

      const message = 'event: broadcast\ndata: {"all": true}\n\n';
      await manager.send(undefined, message);

      expect(data1).toHaveLength(1);
      expect(data2).toHaveLength(1);
    });

    it("should delete stream and clean up Redis", async () => {
      const closed: boolean[] = [];
      const mockController = {
        enqueue: () => {},
        close: () => closed.push(true),
      } as any;

      await manager.create("session-1", mockController);
      expect(await manager.has("session-1")).toBe(true);

      await manager.delete("session-1");

      expect(await manager.has("session-1")).toBe(false);
      expect(manager.localSize).toBe(0);
      expect(closed).toHaveLength(1);
    });

    it("should maintain heartbeat to keep session alive", async () => {
      const mockController = {
        enqueue: () => {},
        close: () => {},
      } as any;

      await manager.create("session-1", mockController);

      const availableKey = "available:test:stream:session-1";

      // Check that key has expiry
      const item = storage.get(availableKey);
      expect(item).toBeDefined();
      expect(item?.expiry).toBeDefined();

      // Wait for heartbeat (should refresh expiry)
      const initialExpiry = item!.expiry;
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const updatedItem = storage.get(availableKey);
      expect(updatedItem?.expiry).toBeDefined();
      expect(updatedItem!.expiry).toBeGreaterThan(initialExpiry!);
    }, 5000);
  });

  describe("Real Redis Integration Tests", () => {
    let realRedis: any;
    let pubSubRedis: any;
    let manager: RedisStreamManager;

    beforeEach(async (ctx) => {
      if (!process.env.REDIS_URL && !process.env.REDISHOST) {
        ctx.skip();
        return;
      }

      try {
        const redis = await import("redis");

        realRedis = redis.createClient({
          url: process.env.REDIS_URL,
          password: process.env.REDIS_PASSWORD || process.env.REDISPASSWORD,
          socket: {
            host: process.env.REDISHOST,
            port: process.env.REDISPORT
              ? parseInt(process.env.REDISPORT)
              : 6379,
          },
          username: process.env.REDISUSER,
        });

        pubSubRedis = realRedis.duplicate();

        await realRedis.connect();
        await pubSubRedis.connect();

        manager = new RedisStreamManager({
          client: realRedis,
          pubSubClient: pubSubRedis,
          prefix: "test:stream:",
          heartbeatInterval: 5,
        });
      } catch (error) {
        console.warn(
          "Redis stream manager tests skipped - redis package not installed or connection failed"
        );
        ctx.skip();
      }
    });

    afterEach(async () => {
      if (manager) {
        await manager.close();
      }
      if (realRedis) {
        await realRedis.quit();
      }
      if (pubSubRedis) {
        await pubSubRedis.quit();
      }
    });

    it("should create stream with real Redis", async (ctx) => {
      if (!manager) {
        ctx.skip();
        return;
      }

      const mockController = {
        enqueue: () => {},
        close: () => {},
      } as any;

      await manager.create("real-session-1", mockController);

      expect(await manager.has("real-session-1")).toBe(true);

      await manager.delete("real-session-1");
      expect(await manager.has("real-session-1")).toBe(false);
    });

    it("should send messages via Redis Pub/Sub", async (ctx) => {
      if (!manager) {
        ctx.skip();
        return;
      }

      const receivedData: string[] = [];
      const mockController = {
        enqueue: (chunk: Uint8Array) => {
          receivedData.push(new TextDecoder().decode(chunk));
        },
        close: () => {},
      } as any;

      await manager.create("pubsub-session", mockController);

      // Give subscription time to register
      await new Promise((resolve) => setTimeout(resolve, 100));

      const message = 'event: test\ndata: {"redis": "pubsub"}\n\n';
      await manager.send(["pubsub-session"], message);

      // Give message time to propagate
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(receivedData.length).toBeGreaterThan(0);
      expect(receivedData[0]).toBe(message);
    }, 10000);
  });
});
