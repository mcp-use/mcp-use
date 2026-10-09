/**
 * Redis Stream Manager
 *
 * Manages active SSE connections using Redis Pub/Sub for distributed notifications.
 * Enables server-to-client push notifications across multiple server instances.
 *
 * **Note:** Redis is an optional dependency. Install it with:
 * ```bash
 * npm install redis
 * # or
 * pnpm add redis
 * ```
 *
 * If Redis is not installed, importing this module will throw an error at runtime
 * when attempting to use RedisStreamManager. Use dynamic imports with error handling
 * if you want to gracefully fall back when Redis is not available.
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
  private streamGenerations = new Map<string, symbol>();

  /**
   * Map of heartbeat intervals for keeping sessions alive
   * Key: sessionId, Value: interval timer
   */
  private heartbeats = new Map<string, NodeJS.Timeout>();

  // Track attempted subscriptions separately from controllers: a disconnected
  // controller or a rejected subscribe() must not lose its cleanup ownership.
  private sessionSubscriptions = new Map<string, Set<string>>();
  private sessionOperations = new Map<string, Promise<void>>();
  private closing = false;

  /**
   * Unique identifier for this server instance, used for request/response routing.
   */
  private serverId = crypto.randomUUID();

  /**
   * Handler for responses forwarded from other server instances.
   */
  private forwardedResponseHandler?: (
    message: unknown,
    sessionId: string
  ) => void;

  /**
   * Whether the server-level response channel subscription is active.
   */
  private serverChannelSubscribed = false;
  private serverChannelSubscription?: Promise<void>;

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
   * Get the Redis key for the active sessions SET
   */
  private getActiveSessionsKey(): string {
    return `${this.prefix}active`;
  }

  private withSessionOperation<T>(
    sessionId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.sessionOperations.get(sessionId) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(
      () => {},
      () => {}
    );
    this.sessionOperations.set(sessionId, settled);
    void settled.then(() => {
      if (this.sessionOperations.get(sessionId) === settled) {
        this.sessionOperations.delete(sessionId);
      }
    });
    return result;
  }

  private clearLocalStream(sessionId: string): void {
    const heartbeat = this.heartbeats.get(sessionId);
    if (heartbeat) clearInterval(heartbeat);
    this.heartbeats.delete(sessionId);

    const controller = this.localControllers.get(sessionId);
    this.localControllers.delete(sessionId);
    this.streamGenerations.delete(sessionId);
    this.closeController(controller);
  }

  private closeController(
    controller: ReadableStreamDefaultController | undefined
  ): void {
    try {
      controller?.close();
    } catch {
      // The client may already have closed the stream.
    }
  }

  private async unsubscribeSession(sessionId: string): Promise<void> {
    const channels = this.sessionSubscriptions.get(sessionId);
    if (!channels?.size) return;
    if (!this.pubSubClient.unsubscribe) {
      throw new Error(
        "[RedisStreamManager] Redis client does not support unsubscribe method"
      );
    }
    const results = await Promise.allSettled(
      Array.from(channels, async (channel) => {
        await this.pubSubClient.unsubscribe!(channel);
        channels.delete(channel);
      })
    );
    if (!channels.size) this.sessionSubscriptions.delete(sessionId);
    this.throwCleanupError(results);
  }

  private throwCleanupError(results: PromiseSettledResult<unknown>[]): void {
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  private async removeAvailability(sessionId: string): Promise<void> {
    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        this.client.del(this.getAvailableKey(sessionId))
      ),
      Promise.resolve().then(() =>
        this.client.sRem?.(this.getActiveSessionsKey(), sessionId)
      ),
    ]);
    this.throwCleanupError(results);
  }

  private async removeStream(
    sessionId: string,
    notifyOtherServers: boolean,
    cleanupAvailability = true
  ): Promise<void> {
    // Always release local resources before any fallible Redis operation.
    this.clearLocalStream(sessionId);
    const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
      this.unsubscribeSession(sessionId),
      cleanupAvailability
        ? this.removeAvailability(sessionId)
        : Promise.resolve(),
    ]);
    // A received deletion must not be broadcast again. Also avoid publishing
    // while our own delete subscription is still active after an error.
    if (notifyOtherServers && results[0].status === "fulfilled") {
      results.push(
        ...(await Promise.allSettled([
          Promise.resolve().then(() => {
            if (!this.client.publish) {
              throw new Error(
                "[RedisStreamManager] Redis client does not support publish method"
              );
            }
            return this.client.publish(
              `delete:${this.getChannel(sessionId)}`,
              ""
            );
          }),
        ]))
      );
    }
    this.throwCleanupError(results);
  }

  /**
   * Register an active SSE stream and subscribe to Redis channel.
   * Idempotent: if the session already has a subscription, it is cleaned up first.
   */
  async create(
    sessionId: string,
    controller: ReadableStreamDefaultController
  ): Promise<void> {
    return this.withSessionOperation(sessionId, async () => {
      if (this.closing) {
        this.closeController(controller);
        throw new Error("[RedisStreamManager] Stream manager is closed");
      }
      // The SDK can expose the same live controller after a duplicate GET.
      // Re-registering it must not close the stream it is already serving.
      if (this.localControllers.get(sessionId) === controller) return;
      const replacingLocalStream = this.localControllers.has(sessionId);
      this.clearLocalStream(sessionId);
      let controllerRegistered = false;
      try {
        // Serialize reconnects with unsubscribe so an older operation cannot
        // remove the new connection's subscriptions or overwrite its timer.
        await this.unsubscribeSession(sessionId);
        if (this.closing) {
          throw new Error("[RedisStreamManager] Stream manager is closed");
        }
        this.localControllers.set(sessionId, controller);
        controllerRegistered = true;
        const generation = Symbol(sessionId);
        this.streamGenerations.set(sessionId, generation);

        const availableKey = this.getAvailableKey(sessionId);
        const activeSessionsKey = this.getActiveSessionsKey();
        await this.client.set(availableKey, "active");
        if (this.client.expire) {
          await this.client.expire(availableKey, this.heartbeatInterval * 2);
        }
        if (this.client.sAdd) {
          await this.client.sAdd(activeSessionsKey, sessionId);
          if (this.client.expire) {
            await this.client.expire(
              activeSessionsKey,
              this.heartbeatInterval * 2
            );
          }
        }

        if (!this.pubSubClient.subscribe) {
          throw new Error(
            "[RedisStreamManager] Redis client does not support subscribe method"
          );
        }
        const channels = new Set<string>();
        this.sessionSubscriptions.set(sessionId, channels);
        const channel = this.getChannel(sessionId);
        // subscribe() can register its callback and then reject. Record the
        // attempt first so rollback also removes partial subscriptions.
        channels.add(channel);
        await this.pubSubClient.subscribe(channel, (message: string) => {
          if (this.streamGenerations.get(sessionId) !== generation) return;
          const localController = this.localControllers.get(sessionId);
          if (!localController) return;
          try {
            localController.enqueue(this.textEncoder.encode(message));
          } catch {
            this.clearLocalStream(sessionId);
            // A disconnected SSE connection does not delete the MCP session
            // on other servers. Its availability expires without a heartbeat.
            void this.withSessionOperation(sessionId, async () => {
              if (!this.localControllers.has(sessionId)) {
                await this.unsubscribeSession(sessionId);
              }
            }).catch((error) => {
              console.warn(
                `[RedisStreamManager] Failed to unsubscribe disconnected stream ${sessionId}:`,
                error
              );
            });
          }
        });
        const deleteChannel = `delete:${channel}`;
        channels.add(deleteChannel);
        await this.pubSubClient.subscribe(deleteChannel, () => {
          if (this.streamGenerations.get(sessionId) !== generation) return;
          void this.withSessionOperation(sessionId, () =>
            this.removeStream(sessionId, false)
          ).catch((error) => {
            console.warn(
              `[RedisStreamManager] Failed to clean up deleted stream ${sessionId}:`,
              error
            );
          });
        });

        // close() or a message delivered during subscription may already have
        // released this controller. Never allocate a late heartbeat for it.
        if (
          this.closing ||
          this.streamGenerations.get(sessionId) !== generation
        ) {
          throw new Error(
            "[RedisStreamManager] Stream closed during registration"
          );
        }
        const heartbeat = setInterval(async () => {
          try {
            if (this.client.expire) {
              await this.client.expire(
                availableKey,
                this.heartbeatInterval * 2
              );
              await this.client.expire(
                activeSessionsKey,
                this.heartbeatInterval * 2
              );
            }
          } catch (error) {
            console.warn(
              `[RedisStreamManager] Heartbeat failed for session ${sessionId}:`,
              error
            );
          }
        }, this.heartbeatInterval * 1000);
        this.heartbeats.set(sessionId, heartbeat);
        console.log(
          `[RedisStreamManager] Created stream for session ${sessionId}`
        );
      } catch (error) {
        this.clearLocalStream(sessionId);
        if (!controllerRegistered) this.closeController(controller);
        const cleanups = await Promise.allSettled([
          this.unsubscribeSession(sessionId),
          controllerRegistered || replacingLocalStream
            ? this.removeAvailability(sessionId)
            : Promise.resolve(),
        ]);
        for (const cleanup of cleanups) {
          if (cleanup.status === "rejected") {
            console.warn(
              `[RedisStreamManager] Failed to roll back stream ${sessionId}:`,
              cleanup.reason
            );
          }
        }
        console.error(
          `[RedisStreamManager] Error creating stream for ${sessionId}:`,
          error
        );
        throw error;
      }
    });
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
        // Use SET-based tracking instead of KEYS for non-blocking operation
        const activeSessionsKey = this.getActiveSessionsKey();
        if (this.client.sMembers) {
          const sessionIds = await this.client.sMembers(activeSessionsKey);
          for (const sessionId of sessionIds) {
            const channel = this.getChannel(sessionId);
            // Use regular client for publishing (pubSubClient is in subscriber mode)
            if (!this.client.publish) {
              throw new Error(
                "[RedisStreamManager] Redis client does not support publish method"
              );
            }
            await this.client.publish(channel, data);
          }
        } else {
          // Fallback to KEYS if SET operations are not available (should not happen in production)
          const pattern = `available:${this.prefix}*`;
          const keys = await this.client.keys(pattern);
          for (const key of keys) {
            const sessionId = key.replace(`available:${this.prefix}`, "");
            const channel = this.getChannel(sessionId);
            if (!this.client.publish) {
              throw new Error(
                "[RedisStreamManager] Redis client does not support publish method"
              );
            }
            await this.client.publish(channel, data);
          }
        }
      } else {
        // Send to specific sessions
        for (const sessionId of sessionIds) {
          const channel = this.getChannel(sessionId);
          // Use regular client for publishing (pubSubClient is in subscriber mode)
          if (!this.client.publish) {
            throw new Error(
              "[RedisStreamManager] Redis client does not support publish method"
            );
          }
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
    return this.withSessionOperation(sessionId, async () => {
      try {
        await this.removeStream(sessionId, true);
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
    });
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
    this.closing = true;
    this.forwardedResponseHandler = undefined;
    const ownedSessionIds = new Set(this.localControllers.keys());
    const sessionIds = new Set([
      ...this.localControllers.keys(),
      ...this.heartbeats.keys(),
      ...this.sessionSubscriptions.keys(),
      ...this.sessionOperations.keys(),
    ]);
    for (const sessionId of sessionIds) this.clearLocalStream(sessionId);

    const results = await Promise.allSettled([
      ...Array.from(sessionIds, (sessionId) =>
        this.withSessionOperation(sessionId, () =>
          this.removeStream(sessionId, false, ownedSessionIds.has(sessionId))
        )
      ),
      Promise.resolve().then(async () => {
        await this.serverChannelSubscription;
        if (this.serverChannelSubscribed) {
          if (!this.pubSubClient.unsubscribe) {
            throw new Error(
              "[RedisStreamManager] Redis client does not support unsubscribe method"
            );
          }
          await this.pubSubClient.unsubscribe(this.getServerChannel());
          this.serverChannelSubscribed = false;
        }
      }),
    ]);
    this.throwCleanupError(results);
    console.log(`[RedisStreamManager] Closed all streams`);
  }

  /**
   * Get count of active local streams on this server instance
   */
  get localSize(): number {
    return this.localControllers.size;
  }

  // --- Distributed request/response routing ---

  private getRequestRouteKey(
    sessionId: string,
    requestId: string | number
  ): string {
    return `${this.prefix}req-route:${sessionId}:${requestId}`;
  }

  private getServerChannel(): string {
    return `${this.prefix}server:${this.serverId}`;
  }

  /**
   * Register a pending outbound server-to-client request so the response
   * can be routed back to this server instance from any other instance.
   */
  async registerOutboundRequest(
    requestId: string | number,
    sessionId: string
  ): Promise<void> {
    const key = this.getRequestRouteKey(sessionId, requestId);
    const value = JSON.stringify({
      serverId: this.serverId,
      sessionId,
    });
    await this.client.set(key, value);
    if (this.client.expire) {
      await this.client.expire(key, 300); // 5 min TTL
    }
  }

  /**
   * Check if an inbound JSON-RPC response should be forwarded to another server.
   * If so, publish it to the originating server's channel and return true.
   */
  async forwardInboundResponse(
    message: { id: string | number; [key: string]: unknown },
    sessionId: string
  ): Promise<boolean> {
    const key = this.getRequestRouteKey(sessionId, message.id);
    const raw = await this.client.get(key);
    if (!raw) return false;

    let routeInfo: { serverId: string; sessionId: string };
    try {
      routeInfo = JSON.parse(raw);
    } catch {
      return false;
    }

    if (routeInfo.serverId === this.serverId) {
      // Local — the SDK Protocol on this server will handle it directly.
      return false;
    }

    // Forward the response to the originating server's channel
    const targetChannel = `${this.prefix}server:${routeInfo.serverId}`;
    if (!this.client.publish) {
      throw new Error(
        "[RedisStreamManager] Redis client does not support publish method"
      );
    }
    await this.client.publish(
      targetChannel,
      JSON.stringify({ response: message, sessionId: routeInfo.sessionId })
    );

    // Clean up the routing key
    await this.client.del(key);
    return true;
  }

  /**
   * Register a handler for responses forwarded from other server instances.
   * Subscribes to this server's dedicated Pub/Sub channel.
   */
  onForwardedResponse(
    handler: (message: unknown, sessionId: string) => void
  ): void {
    if (this.closing) return;
    this.forwardedResponseHandler = handler;

    if (this.serverChannelSubscribed) return;
    const serverChannel = this.getServerChannel();
    if (!this.pubSubClient.subscribe) {
      console.warn(
        "[RedisStreamManager] Redis client does not support subscribe — response forwarding disabled"
      );
      return;
    }
    this.serverChannelSubscribed = true;
    this.serverChannelSubscription = Promise.resolve()
      .then(() =>
        this.pubSubClient.subscribe!(serverChannel, (raw: string) => {
          try {
            const { response, sessionId } = JSON.parse(raw);
            this.forwardedResponseHandler?.(response, sessionId);
          } catch (error) {
            console.warn(
              `[RedisStreamManager] Failed to parse forwarded response:`,
              error
            );
          }
        })
      )
      .then(() => {})
      .catch(async (error) => {
        try {
          if (this.pubSubClient.unsubscribe) {
            await this.pubSubClient.unsubscribe(serverChannel);
            this.serverChannelSubscribed = false;
          }
        } catch {
          // Keep ownership so close() can retry the partial subscription.
        }
        console.error(
          `[RedisStreamManager] Failed to subscribe to server channel:`,
          error
        );
      });
  }
}
