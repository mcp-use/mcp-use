/**
 * Stream Manager Interface
 *
 * Handles active SSE/streaming connections separately from session metadata storage.
 * This separation enables notifications, sampling, and resource subscriptions to work
 * across distributed servers when using external storage (Redis, Postgres).
 *
 * Inspired by tmcp's split architecture between StreamSessionManager and InfoSessionManager.
 */

/**
 * Abstract interface for managing active SSE stream connections
 *
 * Unlike SessionStore (which stores serializable metadata), StreamManager handles
 * ACTIVE connections that cannot be serialized (ReadableStreamDefaultController, WebSockets).
 *
 * Key responsibilities:
 * - Manage active SSE stream controllers
 * - Enable server-to-client push (notifications, sampling responses)
 * - Support distributed notifications via message bus (Redis Pub/Sub, Postgres NOTIFY)
 *
 * @example
 * ```typescript
 * // Redis-backed stream manager for distributed deployments
 * const streamManager = new RedisStreamManager({
 *   url: process.env.REDIS_URL,
 *   password: process.env.REDIS_PASSWORD
 * });
 *
 * // When SSE connection is established
 * await streamManager.create(sessionId, controller);
 *
 * // From any server instance - send notification to client
 * await streamManager.send([sessionId], 'event: message\ndata: {...}\n\n');
 * ```
 */
export interface StreamManager {
  /**
   * Register an active SSE stream controller for a session
   *
   * @param sessionId - The unique session identifier
   * @param controller - ReadableStreamDefaultController for the SSE connection
   */
  create(
    sessionId: string,
    controller: ReadableStreamDefaultController
  ): Promise<void>;

  /**
   * Send data to one or more active SSE streams
   *
   * In distributed deployments:
   * - Local implementation: directly enqueues to in-memory controller
   * - Redis implementation: publishes to Pub/Sub channel, any server with this session receives it
   * - Postgres implementation: uses NOTIFY/LISTEN for cross-server messaging
   *
   * @param sessionIds - Array of session IDs to send to, or undefined for broadcast to all
   * @param data - SSE-formatted data (e.g., 'event: message\ndata: {...}\n\n')
   */
  send(sessionIds: string[] | undefined, data: string): Promise<void>;

  /**
   * Remove an active SSE stream
   *
   * @param sessionId - The unique session identifier
   */
  delete(sessionId: string): Promise<void>;

  /**
   * Check if an active SSE stream exists for a session
   *
   * @param sessionId - The unique session identifier
   * @returns True if stream exists, false otherwise
   */
  has(sessionId: string): Promise<boolean>;

  /**
   * Close all connections and cleanup resources
   * Should be called on server shutdown
   */
  close?(): Promise<void>;

  // --- Distributed request/response routing (optional) ---
  // These methods enable server-to-client requests (sampling, elicitation, roots)
  // to work across load-balanced servers where the client's response POST may
  // land on a different server than the one that sent the request.

  /**
   * Register a pending outbound server-to-client request so that the response
   * can be routed back to this server instance from any other instance.
   *
   * @param requestId - The JSON-RPC request ID
   * @param sessionId - The session this request belongs to
   */
  registerOutboundRequest?(
    requestId: string | number,
    sessionId: string
  ): Promise<void>;

  /**
   * Check if an inbound JSON-RPC response should be forwarded to another server.
   * If the response matches a pending outbound request on a different server,
   * forward it via the message bus and return true.
   *
   * @param message - The JSON-RPC response message (must have an `id` field)
   * @param sessionId - The session this response belongs to
   * @returns true if the response was forwarded to a remote server, false if local
   */
  forwardInboundResponse?(
    message: { id: string | number; [key: string]: unknown },
    sessionId: string
  ): Promise<boolean>;

  /**
   * Register a handler for responses that have been forwarded from other servers.
   * The handler should feed the response into the local transport so the SDK
   * Protocol can resolve the pending request Promise.
   *
   * @param handler - Called with the JSON-RPC response message and its sessionId
   */
  onForwardedResponse?(
    handler: (message: unknown, sessionId: string) => void
  ): void;
}

export * from "./memory.js";
export * from "./redis.js";

// Note: RedisStreamManager and related types are exported above.
// Redis is an optional dependency - install with: npm install redis
// The classes will work as long as you provide a RedisClient instance.
// Use isRedisAvailable() to check if the redis package is installed.
