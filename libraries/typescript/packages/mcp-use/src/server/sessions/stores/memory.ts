/**
 * In-Memory Session Store
 *
 * Default session storage implementation using JavaScript Map.
 * Sessions are stored in memory and lost on server restart.
 *
 * For production deployments requiring session persistence across restarts,
 * consider implementing a custom SessionStore backed by Redis, PostgreSQL,
 * or another persistent storage system.
 */

import type { SessionStore } from "./index.js";
import type { SessionMetadata } from "../session-manager.js";

/**
 * In-memory session storage (default)
 *
 * Provides fast, local session management without external dependencies.
 * Suitable for:
 * - Development environments
 * - Single-instance deployments
 * - Stateful applications where session loss on restart is acceptable
 *
 * Not suitable for:
 * - Distributed/clustered deployments
 * - Applications requiring session persistence across restarts
 * - Horizontal scaling scenarios
 *
 * @example
 * ```typescript
 * import { MCPServer, InMemorySessionStore } from 'mcp-use/server';
 *
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   sessionStore: new InMemorySessionStore()
 * });
 * ```
 */
export class InMemorySessionStore implements SessionStore {
  /**
   * Internal map storing session metadata
   * Key: sessionId, Value: SessionMetadata
   */
  private sessions = new Map<string, SessionMetadata>();

  /**
   * Retrieve session metadata by ID
   */
  async get(sessionId: string): Promise<SessionMetadata | null> {
    const data = this.sessions.get(sessionId);
    return data ?? null;
  }

  /**
   * Store or update session metadata
   */
  async set(sessionId: string, data: SessionMetadata): Promise<void> {
    this.sessions.set(sessionId, data);
  }

  /**
   * Delete session metadata
   */
  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  /**
   * Check if session exists
   */
  async has(sessionId: string): Promise<boolean> {
    return this.sessions.has(sessionId);
  }

  /**
   * List all session IDs
   */
  async keys(): Promise<string[]> {
    return Array.from(this.sessions.keys());
  }

  /**
   * Store session metadata with TTL (time-to-live)
   *
   * Note: In-memory implementation uses setTimeout for TTL.
   * For production TTL support, use Redis or another store with native TTL.
   */
  async setWithTTL(
    sessionId: string,
    data: SessionMetadata,
    ttlMs: number
  ): Promise<void> {
    this.sessions.set(sessionId, data);

    // Auto-delete after TTL expires
    setTimeout(() => {
      this.sessions.delete(sessionId);
      console.log(`[MCP] Session ${sessionId} expired after ${ttlMs}ms`);
    }, ttlMs);
  }

  /**
   * Get the number of active sessions
   * Useful for monitoring and debugging
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Clear all sessions
   * Useful for testing and manual cleanup
   */
  async clear(): Promise<void> {
    this.sessions.clear();
  }
}
