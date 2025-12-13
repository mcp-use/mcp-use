/**
 * Redis Session Store
 *
 * Production-ready session storage using Redis for persistence across restarts
 * and distributed deployments.
 *
 * **Note:** Redis is an optional dependency. Install it with:
 * ```bash
 * npm install redis
 * # or
 * pnpm add redis
 * ```
 *
 * If Redis is not installed, importing this module will throw an error at runtime
 * when attempting to use RedisSessionStore. Use dynamic imports with error handling
 * if you want to gracefully fall back when Redis is not available.
 *
 * Supports:
 * - Session persistence across server restarts
 * - Distributed session sharing (load balancing)
 * - Automatic TTL-based expiration
 * - Connection pooling and error handling
 */

import type { SessionStore } from "./index.js";
import type { SessionMetadata } from "../session-manager.js";

/**
 * Check if Redis is available as an optional dependency
 * @returns true if Redis can be imported, false otherwise
 */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    await import("redis");
    return true;
  } catch {
    return false;
  }
}

/**
 * Redis client interface - compatible with node-redis v5+ and ioredis
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: any): Promise<string | null>;
  setEx?(key: string, seconds: number, value: string): Promise<string | null>; // node-redis v5+
  setex?(key: string, seconds: number, value: string): Promise<string | null>; // ioredis
  del(key: string | string[]): Promise<number>;
  exists(key: string | string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  expire?(key: string, seconds: number): Promise<boolean | number>; // node-redis v5+
  publish?(channel: string, message: string): Promise<number>; // node-redis v5+ / ioredis
  subscribe?(
    channel: string,
    callback: (message: string) => void
  ): Promise<number | void>; // node-redis v5+ / ioredis
  unsubscribe?(channel: string): Promise<number | void>; // node-redis v5+ / ioredis
  quit(): Promise<string | "OK">;
}

/**
 * Configuration for Redis session store
 */
export interface RedisSessionStoreConfig {
  /**
   * Redis client instance (node-redis or ioredis)
   * Must be already connected
   */
  client: RedisClient;

  /**
   * Key prefix for session storage (default: "mcp:session:")
   */
  prefix?: string;

  /**
   * Default TTL in seconds for sessions (default: 3600 = 1 hour)
   */
  defaultTTL?: number;

  /**
   * Whether to serialize/deserialize session data (default: true)
   */
  serialize?: boolean;
}

/**
 * Redis-backed session metadata storage
 *
 * Stores ONLY serializable metadata (client capabilities, log level, timestamps).
 * For managing active SSE streams, use RedisStreamManager.
 *
 * Suitable for:
 * - Production deployments requiring session persistence
 * - Distributed/clustered applications
 * - Load-balanced environments
 * - Horizontal scaling scenarios
 *
 * @example
 * ```typescript
 * import { MCPServer, RedisSessionStore, RedisStreamManager } from 'mcp-use/server';
 * import { createClient } from 'redis';
 *
 * // Create Redis clients (two needed for Pub/Sub)
 * const redis = createClient({ url: process.env.REDIS_URL });
 * const pubSubRedis = redis.duplicate();
 *
 * await redis.connect();
 * await pubSubRedis.connect();
 *
 * // Create stores
 * const sessionStore = new RedisSessionStore({ client: redis });
 * const streamManager = new RedisStreamManager({
 *   client: redis,
 *   pubSubClient: pubSubRedis
 * });
 *
 * // Use with MCP server
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   sessionStore,
 *   streamManager
 * });
 * ```
 */
export class RedisSessionStore implements SessionStore {
  private client: RedisClient;
  private prefix: string;
  private defaultTTL: number;

  constructor(config: RedisSessionStoreConfig) {
    this.client = config.client;
    this.prefix = config.prefix ?? "mcp:session:";
    this.defaultTTL = config.defaultTTL ?? 3600; // 1 hour default
  }

  /**
   * Get full Redis key for a session ID
   */
  private getKey(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  /**
   * Retrieve session metadata by ID
   */
  async get(sessionId: string): Promise<SessionMetadata | null> {
    try {
      const key = this.getKey(sessionId);
      const data = await this.client.get(key);

      if (!data) {
        return null;
      }

      return JSON.parse(data);
    } catch (error) {
      console.error(
        `[RedisSessionStore] Error getting session ${sessionId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Store or update session metadata
   */
  async set(sessionId: string, data: SessionMetadata): Promise<void> {
    try {
      const key = this.getKey(sessionId);
      const value = JSON.stringify(data);

      // Set with default TTL - support both node-redis v5+ (setEx) and ioredis (setex)
      if (this.client.setEx) {
        await this.client.setEx(key, this.defaultTTL, value);
      } else if (this.client.setex) {
        await this.client.setex(key, this.defaultTTL, value);
      } else {
        // Fallback for custom Redis implementations
        await this.client.set(key, value, { EX: this.defaultTTL });
      }
    } catch (error) {
      console.error(
        `[RedisSessionStore] Error setting session ${sessionId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<void> {
    try {
      const key = this.getKey(sessionId);
      await this.client.del(key);
    } catch (error) {
      console.error(
        `[RedisSessionStore] Error deleting session ${sessionId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Check if a session exists
   */
  async has(sessionId: string): Promise<boolean> {
    try {
      const key = this.getKey(sessionId);
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch (error) {
      console.error(
        `[RedisSessionStore] Error checking session ${sessionId}:`,
        error
      );
      return false;
    }
  }

  /**
   * List all session IDs
   */
  async keys(): Promise<string[]> {
    try {
      const pattern = `${this.prefix}*`;
      const keys = await this.client.keys(pattern);

      // Remove prefix from keys to get session IDs
      return keys.map((key) => key.substring(this.prefix.length));
    } catch (error) {
      console.error("[RedisSessionStore] Error listing session keys:", error);
      return [];
    }
  }

  /**
   * Store session metadata with custom TTL (time-to-live)
   */
  async setWithTTL(
    sessionId: string,
    data: SessionMetadata,
    ttlMs: number
  ): Promise<void> {
    try {
      const key = this.getKey(sessionId);
      const value = JSON.stringify(data);
      const ttlSeconds = Math.ceil(ttlMs / 1000);

      // Support both node-redis v5+ (setEx) and ioredis (setex)
      if (this.client.setEx) {
        await this.client.setEx(key, ttlSeconds, value);
      } else if (this.client.setex) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value, { EX: ttlSeconds });
      }
    } catch (error) {
      console.error(
        `[RedisSessionStore] Error setting session ${sessionId} with TTL:`,
        error
      );
      throw error;
    }
  }

  /**
   * Close Redis connection
   * Should be called when shutting down the server
   */
  async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch (error) {
      console.error(
        "[RedisSessionStore] Error closing Redis connection:",
        error
      );
      throw error;
    }
  }

  /**
   * Clear all sessions (useful for testing)
   * WARNING: This will delete all sessions with the configured prefix
   */
  async clear(): Promise<void> {
    try {
      const pattern = `${this.prefix}*`;
      const keys = await this.client.keys(pattern);

      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } catch (error) {
      console.error("[RedisSessionStore] Error clearing sessions:", error);
      throw error;
    }
  }
}
