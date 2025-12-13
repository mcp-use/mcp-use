/**
 * In-Memory Stream Manager
 *
 * Default implementation for managing active SSE connections in a single server instance.
 * Streams are stored in memory and lost on server restart.
 *
 * For distributed deployments, use RedisStreamManager or PostgresStreamManager.
 */

import type { StreamManager } from "./index.js";

/**
 * In-memory stream management for SSE connections
 *
 * Stores active ReadableStreamDefaultController instances for pushing
 * server-initiated messages (notifications, sampling responses) to clients.
 *
 * Suitable for:
 * - Single-instance deployments
 * - Development environments
 * - Non-distributed architectures
 *
 * Not suitable for:
 * - Load-balanced deployments (streams on different servers)
 * - Horizontal scaling
 * - Session persistence requirements
 *
 * @example
 * ```typescript
 * import { MCPServer, InMemoryStreamManager } from 'mcp-use/server';
 *
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   streamManager: new InMemoryStreamManager()
 * });
 * ```
 */
export class InMemoryStreamManager implements StreamManager {
  /**
   * Map of active SSE stream controllers
   * Key: sessionId, Value: ReadableStreamDefaultController
   */
  private streams = new Map<string, ReadableStreamDefaultController>();

  /**
   * Text encoder for converting strings to Uint8Array
   */
  private textEncoder = new TextEncoder();

  /**
   * Register an active SSE stream controller
   */
  async create(
    sessionId: string,
    controller: ReadableStreamDefaultController
  ): Promise<void> {
    this.streams.set(sessionId, controller);
  }

  /**
   * Send data to active SSE streams
   *
   * Directly enqueues data to in-memory controllers.
   * For distributed deployments, use RedisStreamManager instead.
   */
  async send(sessionIds: string[] | undefined, data: string): Promise<void> {
    const encoded = this.textEncoder.encode(data);

    if (!sessionIds) {
      // Broadcast to all active streams
      for (const [_id, controller] of this.streams.entries()) {
        try {
          controller.enqueue(encoded);
        } catch (error) {
          console.warn(
            `[InMemoryStreamManager] Failed to send to session ${_id}:`,
            error
          );
        }
      }
    } else {
      // Send to specific sessions
      for (const sessionId of sessionIds) {
        const controller = this.streams.get(sessionId);
        if (controller) {
          try {
            controller.enqueue(encoded);
          } catch (error) {
            console.warn(
              `[InMemoryStreamManager] Failed to send to session ${sessionId}:`,
              error
            );
          }
        }
      }
    }
  }

  /**
   * Remove an active SSE stream
   */
  async delete(sessionId: string): Promise<void> {
    const controller = this.streams.get(sessionId);
    if (controller) {
      try {
        controller.close();
      } catch (error) {
        // Controller might already be closed
        console.debug(
          `[InMemoryStreamManager] Controller already closed for session ${sessionId}`
        );
      }
      this.streams.delete(sessionId);
    }
  }

  /**
   * Check if an active stream exists
   */
  async has(sessionId: string): Promise<boolean> {
    return this.streams.has(sessionId);
  }

  /**
   * Close all active streams
   */
  async close(): Promise<void> {
    for (const [sessionId, controller] of this.streams.entries()) {
      try {
        controller.close();
      } catch (error) {
        console.debug(
          `[InMemoryStreamManager] Error closing stream for ${sessionId}:`,
          error
        );
      }
    }
    this.streams.clear();
  }

  /**
   * Get the number of active streams
   * Useful for monitoring
   */
  get size(): number {
    return this.streams.size;
  }
}
