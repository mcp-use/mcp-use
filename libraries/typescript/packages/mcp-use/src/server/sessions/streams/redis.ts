/**
 * Redis Stream Manager
 *
 * Manages active SSE connections using Redis Pub/Sub for distributed notifications.
 * Enables server-to-client push notifications across multiple server instances.
 */

import type { StreamManager } from "./index.js";
import type { RedisClient } from "../stores/redis.js";

/**
 * Configuration for Redis stream manager
 */
export interface RedisStreamManagerConfig {
  /**
   * Redis client for Pub/Sub subscriptions
   * Should be a separate client from the main Redis client
   */
  pubSubClient: RedisClient;

  /**
   * Redis client for checking session availability
   * Can be shared with SessionStore
   */
  client: RedisClient;

  /**
   * Channel prefix for Pub/Sub (default: "mcp:stream:")
   */
  prefix?: string;

  /**
   * Heartbeat interval in seconds to keep sessions alive (default: 10)
   * Redis keys expire after this interval * 2
   */
  heartbeatInterval?: number;
}

/**
 * Redis-backed stream management for distributed SSE connections
 *
 * Enables notifications, sampling, and resource subscriptions to work across
 * multiple server instances using Redis Pub/Sub.
 *
 * Architecture:
 * 1. Client connects to Server A → creates SSE stream
 * 2. Server A subscribes to Redis channel `mcp:stream:{sessionId}`
 * 3. Client makes request → Load balancer routes to Server B
 * 4. Server B sends notification → publishes to Redis channel
 * 5. Server A receives Redis message → pushes to SSE stream → Client gets notification
 *
 * @example
 * ```typescript
 * import { MCPServer, RedisStreamManager } from 'mcp-use/server';
 * import { createClient } from 'redis';
 *
 * // Create two separate Redis clients (required for Pub/Sub)
 * const redis = createClient({ url: process.env.REDIS_URL });
 * const pubSubRedis = redis.duplicate();
 *
 * await redis.connect();
 * await pubSubRedis.connect();
 *
 * const streamManager = new RedisStreamManager({
 *   client: redis,
 *   pubSubClient: pubSubRedis
 * });
 *
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   streamManager
 * });
 * ```
 */
export class RedisStreamManager implements StreamManager {
  private pubSubClient: RedisClient;
  private client: RedisClient;
  private prefix: string;
  private heartbeatInterval: number;
  private textEncoder = new TextEncoder();

  /**
   * Map of local controllers (only on this server instance)
   * Key: sessionId, Value: controller
   */
  private localControllers = new Map<string, ReadableStreamDefaultController>();

  /**
   * Map of heartbeat intervals for keeping sessions alive
   * Key: sessionId, Value: interval timer
   */
  private heartbeats = new Map<string, NodeJS.Timeout>();

  constructor(config: RedisStreamManagerConfig) {
    this.pubSubClient = config.pubSubClient;
    this.client = config.client;
    this.prefix = config.prefix ?? "mcp:stream:";
    this.heartbeatInterval = config.heartbeatInterval ?? 10; // 10 seconds
  }

  /**
   * Get the Redis channel name for a session
   */
  private getChannel(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  /**
   * Get the Redis key for tracking active sessions
   */
  private getAvailableKey(sessionId: string): string {
    return `available:${this.prefix}${sessionId}`;
  }

  /**
   * Register an active SSE stream and subscribe to Redis channel
   */
  async create(
    sessionId: string,
    controller: ReadableStreamDefaultController
  ): Promise<void> {
    try {
      // Store controller locally
      this.localControllers.set(sessionId, controller);

      // Mark session as available in Redis
      const availableKey = this.getAvailableKey(sessionId);
      await this.client.set(availableKey, "active");

      // Set expiry - support both node-redis v5+ and ioredis
      if (this.client.expire) {
        await this.client.expire(availableKey, this.heartbeatInterval * 2);
      }

      // Set up heartbeat to keep session alive
      const heartbeat = setInterval(async () => {
        try {
          if (this.client.expire) {
            await this.client.expire(availableKey, this.heartbeatInterval * 2);
          }
        } catch (error) {
          console.warn(
            `[RedisStreamManager] Heartbeat failed for session ${sessionId}:`,
            error
          );
        }
      }, this.heartbeatInterval * 1000);

      this.heartbeats.set(sessionId, heartbeat);

      // Subscribe to Redis Pub/Sub channel for this session
      const channel = this.getChannel(sessionId);
      await this.pubSubClient.subscribe(channel, (message: string) => {
        const localController = this.localControllers.get(sessionId);
        if (localController) {
          try {
            localController.enqueue(this.textEncoder.encode(message));
          } catch (error) {
            console.warn(
              `[RedisStreamManager] Failed to enqueue message for ${sessionId}:`,
              error
            );
          }
        }
      });

      // Also subscribe to delete channel
      const deleteChannel = `delete:${this.getChannel(sessionId)}`;
      await this.pubSubClient.subscribe(deleteChannel, async () => {
        await this.delete(sessionId);
      });

      console.log(
        `[RedisStreamManager] Created stream for session ${sessionId}`
      );
    } catch (error) {
      console.error(
        `[RedisStreamManager] Error creating stream for ${sessionId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Send data to sessions via Redis Pub/Sub
   *
   * This works across distributed servers - any server with an active
   * SSE connection for the target session will receive and forward the message.
   *
   * Note: Uses the regular client (not pubSubClient) for publishing.
   * In node-redis v5+, clients in subscriber mode cannot publish.
   */
  async send(sessionIds: string[] | undefined, data: string): Promise<void> {
    try {
      if (!sessionIds) {
        // Broadcast to ALL active sessions across all servers
        const pattern = `available:${this.prefix}*`;
        const keys = await this.client.keys(pattern);

        for (const key of keys) {
          const sessionId = key.replace(`available:${this.prefix}`, "");
          const channel = this.getChannel(sessionId);
          // Use regular client for publishing (pubSubClient is in subscriber mode)
          await this.client.publish(channel, data);
        }
      } else {
        // Send to specific sessions
        for (const sessionId of sessionIds) {
          const channel = this.getChannel(sessionId);
          // Use regular client for publishing (pubSubClient is in subscriber mode)
          await this.client.publish(channel, data);
        }
      }
    } catch (error) {
      console.error(`[RedisStreamManager] Error sending to sessions:`, error);
      throw error;
    }
  }

  /**
   * Remove an active SSE stream
   */
  async delete(sessionId: string): Promise<void> {
    try {
      // Stop heartbeat
      const heartbeat = this.heartbeats.get(sessionId);
      if (heartbeat) {
        clearInterval(heartbeat);
        this.heartbeats.delete(sessionId);
      }

      // Unsubscribe from Redis channels
      const channel = this.getChannel(sessionId);
      const deleteChannel = `delete:${channel}`;

      await this.pubSubClient.unsubscribe(channel);
      await this.pubSubClient.unsubscribe(deleteChannel);

      // Publish delete message to notify other servers (use regular client for publishing)
      await this.client.publish(deleteChannel, "");

      // Delete availability key
      await this.client.del(this.getAvailableKey(sessionId));

      // Close local controller if exists
      const controller = this.localControllers.get(sessionId);
      if (controller) {
        try {
          controller.close();
        } catch (error) {
          console.debug(
            `[RedisStreamManager] Controller already closed for ${sessionId}`
          );
        }
        this.localControllers.delete(sessionId);
      }

      console.log(
        `[RedisStreamManager] Deleted stream for session ${sessionId}`
      );
    } catch (error) {
      console.error(
        `[RedisStreamManager] Error deleting stream for ${sessionId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Check if a session has an active stream (on ANY server)
   */
  async has(sessionId: string): Promise<boolean> {
    try {
      const availableKey = this.getAvailableKey(sessionId);
      const exists = await this.client.exists(availableKey);
      return exists === 1;
    } catch (error) {
      console.error(
        `[RedisStreamManager] Error checking session ${sessionId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Close all connections and cleanup
   */
  async close(): Promise<void> {
    try {
      // Clear all heartbeats
      for (const heartbeat of this.heartbeats.values()) {
        clearInterval(heartbeat);
      }
      this.heartbeats.clear();

      // Close all local controllers
      for (const controller of this.localControllers.values()) {
        try {
          controller.close();
        } catch (error) {
          // Ignore
        }
      }
      this.localControllers.clear();

      console.log(`[RedisStreamManager] Closed all streams`);
    } catch (error) {
      console.error(`[RedisStreamManager] Error during close:`, error);
      throw error;
    }
  }

  /**
   * Get count of active local streams on this server instance
   */
  get localSize(): number {
    return this.localControllers.size;
  }
}
