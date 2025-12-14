/**
 * Session Storage Interface
 *
 * Pluggable session storage for MCP servers to support different persistence backends.
 * Default implementation is in-memory (InMemorySessionStore).
 *
 * For persistent sessions across server restarts, implement custom stores:
 * - RedisSessionStore (for distributed deployments)
 * - PostgresSessionStore (for database-backed persistence)
 * - FileSystemSessionStore (for simple file-based persistence)
 */

import type { SessionMetadata } from "../session-manager.js";

/**
 * Abstract interface for session metadata storage
 *
 * Stores ONLY serializable session metadata (client capabilities, log level, timestamps).
 * Does NOT store runtime objects (transport, server instances, controllers).
 *
 * For managing active SSE connections, use StreamManager.
 *
 * Inspired by tmcp's split architecture (InfoSessionManager + StreamSessionManager).
 * All methods are async to support external storage backends (Redis, Postgres, etc.)
 *
 * @example
 * ```typescript
 * // Custom Redis implementation
 * class RedisSessionStore implements SessionStore {
 *   constructor(private redis: RedisClient) {}
 *
 *   async get(sessionId: string): Promise<SessionMetadata | null> {
 *     const data = await this.redis.get(`session:${sessionId}`);
 *     return data ? JSON.parse(data) : null;
 *   }
 *
 *   async set(sessionId: string, data: SessionMetadata): Promise<void> {
 *     await this.redis.set(`session:${sessionId}`, JSON.stringify(data));
 *   }
 *
 *   async delete(sessionId: string): Promise<void> {
 *     await this.redis.del(`session:${sessionId}`);
 *   }
 *
 *   async has(sessionId: string): Promise<boolean> {
 *     return (await this.redis.exists(`session:${sessionId}`)) === 1;
 *   }
 *
 *   async keys(): Promise<string[]> {
 *     return await this.redis.keys('session:*');
 *   }
 * }
 * ```
 */
export interface SessionStore {
  /**
   * Retrieve session metadata by ID
   * @param sessionId - The unique session identifier
   * @returns Session metadata if found, null otherwise
   */
  get(sessionId: string): Promise<SessionMetadata | null>;

  /**
   * Store or update session metadata
   * @param sessionId - The unique session identifier
   * @param data - Session metadata to store (serializable only)
   */
  set(sessionId: string, data: SessionMetadata): Promise<void>;

  /**
   * Delete session metadata
   * @param sessionId - The unique session identifier
   */
  delete(sessionId: string): Promise<void>;

  /**
   * Check if session metadata exists
   * @param sessionId - The unique session identifier
   * @returns True if session exists, false otherwise
   */
  has(sessionId: string): Promise<boolean>;

  /**
   * List all session IDs
   * Used for cleanup operations and monitoring
   * @returns Array of session IDs
   */
  keys(): Promise<string[]>;

  /**
   * Optional: Store session metadata with automatic expiration (TTL)
   * @param sessionId - The unique session identifier
   * @param data - Session metadata to store
   * @param ttlMs - Time to live in milliseconds
   */
  setWithTTL?(
    sessionId: string,
    data: SessionMetadata,
    ttlMs: number
  ): Promise<void>;
}

export * from "./memory.js";
export * from "./redis.js";
export * from "./filesystem.js";
