/**
 * Tests for Session Store implementations
 *
 * Tests both InMemorySessionStore and RedisSessionStore
 * Run with: pnpm test tests/unit/server/session-stores.test.ts
 * Run with Redis: infisical run --env=dev --projectId=13272018-648f-41fd-911c-908a27c9901e -- pnpm test tests/unit/server/session-stores.test.ts
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  FileSystemSessionStore,
  InMemorySessionStore,
  RedisSessionStore,
} from "../../../src/server/index.js";
import type {
  SessionMetadata,
  SessionData,
  RedisClient,
} from "../../../src/server/index.js";

describe("InMemorySessionStore", () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  describe("Basic Operations", () => {
    it("should start empty", async () => {
      const keys = await store.keys();
      expect(keys).toHaveLength(0);
      expect(store.size).toBe(0);
    });

    it("should set and get session data", async () => {
      const sessionData: SessionData = {
        transport: {} as any,
        lastAccessedAt: Date.now(),
        clientCapabilities: { sampling: {} },
      };

      await store.set("session-1", sessionData);
      const retrieved = await store.get("session-1");

      expect(retrieved).toBeDefined();
      expect(retrieved?.lastAccessedAt).toBe(sessionData.lastAccessedAt);
      expect(retrieved?.clientCapabilities).toEqual(
        sessionData.clientCapabilities
      );
    });

    it("should return null for non-existent session", async () => {
      const result = await store.get("nonexistent");
      expect(result).toBeNull();
    });

    it("should check if session exists", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      await store.set("session-1", sessionData);

      expect(await store.has("session-1")).toBe(true);
      expect(await store.has("nonexistent")).toBe(false);
    });

    it("should delete sessions", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      await store.set("session-1", sessionData);
      expect(await store.has("session-1")).toBe(true);

      await store.delete("session-1");
      expect(await store.has("session-1")).toBe(false);
      expect(await store.get("session-1")).toBeNull();
    });

    it("should list all session keys", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      await store.set("session-1", sessionData);
      await store.set("session-2", sessionData);
      await store.set("session-3", sessionData);

      const keys = await store.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain("session-1");
      expect(keys).toContain("session-2");
      expect(keys).toContain("session-3");
    });

    it("should track size correctly", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      expect(store.size).toBe(0);

      await store.set("session-1", sessionData);
      expect(store.size).toBe(1);

      await store.set("session-2", sessionData);
      expect(store.size).toBe(2);

      await store.delete("session-1");
      expect(store.size).toBe(1);

      await store.clear();
      expect(store.size).toBe(0);
    });

    it("should clear all sessions", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      await store.set("session-1", sessionData);
      await store.set("session-2", sessionData);
      expect(store.size).toBe(2);

      await store.clear();
      expect(store.size).toBe(0);
      expect(await store.has("session-1")).toBe(false);
      expect(await store.has("session-2")).toBe(false);
    });
  });

  describe("TTL Support", () => {
    it("should auto-delete session after TTL expires", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      await store.setWithTTL("session-ttl", sessionData, 100); // 100ms TTL
      expect(await store.has("session-ttl")).toBe(true);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await store.has("session-ttl")).toBe(false);
    });

    it("should not affect other sessions when TTL expires", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      await store.set("session-permanent", sessionData);
      await store.setWithTTL("session-ttl", sessionData, 100);

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(await store.has("session-permanent")).toBe(true);
      expect(await store.has("session-ttl")).toBe(false);
    });
  });

  describe("Update Operations", () => {
    it("should update existing session data", async () => {
      const initialData: SessionMetadata = {
        lastAccessedAt: 1000,
        logLevel: "info",
      };

      await store.set("session-1", initialData);

      const updatedData: SessionMetadata = {
        lastAccessedAt: 2000,
        logLevel: "debug",
      };

      await store.set("session-1", updatedData);
      const retrieved = await store.get("session-1");

      expect(retrieved?.lastAccessedAt).toBe(2000);
      expect(retrieved?.logLevel).toBe("debug");
    });
  });
});

describe("FileSystemSessionStore", () => {
  let tempDir: string;
  let sessionFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-use-session-store-"));
    sessionFile = join(tempDir, "sessions.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function readSessions(): Record<string, SessionMetadata> {
    return JSON.parse(readFileSync(sessionFile, "utf-8"));
  }

  it("coalesces bursty updates into one debounced write", async () => {
    const store = new FileSystemSessionStore({
      path: sessionFile,
      debounceMs: 20,
      minSaveIntervalMs: 100,
    });

    const sessionData: SessionMetadata = {
      lastAccessedAt: Date.now(),
    };

    await store.set("session-1", sessionData);
    await store.set("session-2", sessionData);
    await store.set("session-3", sessionData);

    await wait(10);
    expect(existsSync(sessionFile)).toBe(false);

    await wait(30);
    expect(Object.keys(readSessions()).sort()).toEqual([
      "session-1",
      "session-2",
      "session-3",
    ]);
  });

  it("enforces the minimum interval between sustained writes", async () => {
    const store = new FileSystemSessionStore({
      path: sessionFile,
      debounceMs: 10,
      minSaveIntervalMs: 100,
    });

    const sessionData: SessionMetadata = {
      lastAccessedAt: Date.now(),
    };

    await store.set("session-1", sessionData);
    await wait(30);
    expect(Object.keys(readSessions())).toEqual(["session-1"]);

    await store.set("session-2", sessionData);
    await wait(50);
    expect(Object.keys(readSessions())).toEqual(["session-1"]);

    await wait(80);
    expect(Object.keys(readSessions()).sort()).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  it("caps filesystem saves per rolling second", async () => {
    const store = new FileSystemSessionStore({
      path: sessionFile,
      debounceMs: 0,
      minSaveIntervalMs: 0,
      maxSavesPerSecond: 2,
    });

    const sessionData: SessionMetadata = {
      lastAccessedAt: Date.now(),
    };

    await store.set("session-1", sessionData);
    await wait(20);
    expect(Object.keys(readSessions())).toEqual(["session-1"]);

    await store.set("session-2", sessionData);
    await wait(20);
    expect(Object.keys(readSessions()).sort()).toEqual([
      "session-1",
      "session-2",
    ]);

    await store.set("session-3", sessionData);
    await wait(100);
    expect(Object.keys(readSessions()).sort()).toEqual([
      "session-1",
      "session-2",
    ]);

    await wait(950);
    expect(Object.keys(readSessions()).sort()).toEqual([
      "session-1",
      "session-2",
      "session-3",
    ]);
  });

  it("flushes immediately for process-exit persistence", async () => {
    const store = new FileSystemSessionStore({
      path: sessionFile,
      debounceMs: 10_000,
      minSaveIntervalMs: 10_000,
    });

    const sessionData: SessionMetadata = {
      lastAccessedAt: Date.now(),
    };

    await store.set("session-1", sessionData);
    await store.flush();

    expect(Object.keys(readSessions())).toEqual(["session-1"]);
  });
});

describe("RedisSessionStore", () => {
  // Only run Redis tests if Redis is configured
  const REDIS_AVAILABLE = process.env.REDIS_URL || process.env.REDISHOST;

  if (!REDIS_AVAILABLE) {
    it.skip("Redis tests skipped - no Redis configuration found", () => {});
    return;
  }

  let store: RedisSessionStore;
  let mockRedis: RedisClient;

  describe("Mock Redis Client Tests", () => {
    beforeEach(() => {
      // Create a mock Redis client for unit testing
      const storage = new Map<string, { value: string; expiry?: number }>();

      mockRedis = {
        async get(key: string) {
          const item = storage.get(key);
          if (!item) return null;
          if (item.expiry && Date.now() >= item.expiry) {
            storage.delete(key);
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
          // Simulate Redis TTL by auto-deleting after expiry
          setTimeout(() => {
            const item = storage.get(key);
            if (item && item.expiry === expiry) {
              storage.delete(key);
            }
          }, seconds * 1000);
          return "OK";
        },
        async del(key: string | string[]) {
          const keys = Array.isArray(key) ? key : [key];
          let deleted = 0;
          keys.forEach((k) => {
            if (storage.delete(k)) deleted++;
          });
          return deleted;
        },
        async exists(key: string | string[]) {
          const keys = Array.isArray(key) ? key : [key];
          let count = 0;
          for (const k of keys) {
            const item = storage.get(k);
            if (item && (!item.expiry || Date.now() < item.expiry)) {
              count++;
            }
          }
          return count;
        },
        async keys(pattern: string) {
          const prefix = pattern.replace(/\*/g, "");
          return Array.from(storage.keys()).filter((k) => {
            const item = storage.get(k);
            return (
              k.startsWith(prefix) &&
              (!item?.expiry || Date.now() < item.expiry)
            );
          });
        },
        async quit() {
          storage.clear();
          return "OK";
        },
      };

      store = new RedisSessionStore({
        client: mockRedis,
        prefix: "test:session:",
        defaultTTL: 3600,
      });
    });

    afterEach(async () => {
      await store.clear();
    });

    it("should set and get session data", async () => {
      const sessionData: SessionData = {
        transport: {} as any,
        lastAccessedAt: Date.now(),
        clientCapabilities: { sampling: {} },
      };

      await store.set("session-1", sessionData);
      const retrieved = await store.get("session-1");

      expect(retrieved).toBeDefined();
      expect(retrieved?.lastAccessedAt).toBe(sessionData.lastAccessedAt);
      expect(retrieved?.clientCapabilities).toEqual(
        sessionData.clientCapabilities
      );
    });

    it("should return null for non-existent session", async () => {
      const result = await store.get("nonexistent");
      expect(result).toBeNull();
    });

    it("should check if session exists", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      await store.set("session-1", sessionData);

      expect(await store.has("session-1")).toBe(true);
      expect(await store.has("nonexistent")).toBe(false);
    });

    it("should delete sessions", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      await store.set("session-1", sessionData);
      expect(await store.has("session-1")).toBe(true);

      await store.delete("session-1");
      expect(await store.has("session-1")).toBe(false);
    });

    it("should list all session keys", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      await store.set("session-1", sessionData);
      await store.set("session-2", sessionData);
      await store.set("session-3", sessionData);

      const keys = await store.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain("session-1");
      expect(keys).toContain("session-2");
      expect(keys).toContain("session-3");
    });

    it("should use custom key prefix", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      await store.set("session-1", sessionData);

      // Check that the key uses the custom prefix
      const allKeys = await mockRedis.keys("test:session:*");
      expect(allKeys).toHaveLength(1);
      expect(allKeys[0]).toBe("test:session:session-1");
    });

    it("should support custom TTL", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      // Use 1 second TTL for more reliable testing
      await store.setWithTTL("session-ttl", sessionData, 1000); // 1 second
      expect(await store.has("session-ttl")).toBe(true);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(await store.has("session-ttl")).toBe(false);
    }, 5000); // Increase test timeout to 5 seconds

    it("should store metadata correctly", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: 12345,
        clientCapabilities: { sampling: {}, elicitation: {} },
        logLevel: "debug",
        clientInfo: { name: "test-client", version: "1.0" },
        protocolVersion: "2025-11-25",
      };

      await store.set("session-1", sessionData);
      const retrieved = await store.get("session-1");

      // All metadata fields should be preserved
      expect(retrieved?.lastAccessedAt).toBe(12345);
      expect(retrieved?.clientCapabilities).toEqual({
        sampling: {},
        elicitation: {},
      });
      expect(retrieved?.logLevel).toBe("debug");
      expect(retrieved?.clientInfo).toEqual({
        name: "test-client",
        version: "1.0",
      });
      expect(retrieved?.protocolVersion).toBe("2025-11-25");
    });

    it("should clear all sessions", async () => {
      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      await store.set("session-1", sessionData);
      await store.set("session-2", sessionData);

      const keysBefore = await store.keys();
      expect(keysBefore).toHaveLength(2);

      await store.clear();

      const keysAfter = await store.keys();
      expect(keysAfter).toHaveLength(0);
    });
  });

  // Integration tests with real Redis (requires environment variables)
  describe("Real Redis Integration Tests", () => {
    let realRedis: any;
    let realStore: RedisSessionStore;

    beforeEach(async () => {
      // Only run if Redis environment variables are available
      if (!process.env.REDIS_URL && !process.env.REDISHOST) {
        return;
      }

      try {
        // Dynamic import to avoid errors if redis is not installed
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

        await realRedis.connect();

        realStore = new RedisSessionStore({
          client: realRedis,
          prefix: "test:mcp:session:",
          defaultTTL: 60, // 1 minute for tests
        });
      } catch (error) {
        console.warn(
          "Redis integration tests skipped - redis package not installed or connection failed"
        );
      }
    });

    afterEach(async () => {
      if (realStore && realRedis) {
        await realStore.clear();
        await realRedis.quit();
      }
    });

    it("should work with real Redis connection", async (ctx) => {
      if (!realStore) {
        ctx.skip();
        return;
      }

      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
        clientCapabilities: { sampling: {} },
        logLevel: "info",
      };

      await realStore.set("real-session-1", sessionData);

      const retrieved = await realStore.get("real-session-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.lastAccessedAt).toBe(sessionData.lastAccessedAt);
      expect(retrieved?.logLevel).toBe("info");

      await realStore.delete("real-session-1");
      expect(await realStore.has("real-session-1")).toBe(false);
    });

    it("should handle concurrent operations", async (ctx) => {
      if (!realStore) {
        ctx.skip();
        return;
      }

      const sessionData: SessionMetadata = {
        lastAccessedAt: Date.now(),
      };

      // Create multiple sessions concurrently
      const promises = Array.from({ length: 10 }, (_, i) =>
        realStore.set(`concurrent-${i}`, sessionData)
      );

      await Promise.all(promises);

      const keys = await realStore.keys();
      const concurrentKeys = keys.filter((k) => k.startsWith("concurrent-"));
      expect(concurrentKeys).toHaveLength(10);
    });
  });
});
