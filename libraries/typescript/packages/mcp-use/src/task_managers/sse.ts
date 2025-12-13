/**
 * SSE Connection Manager
 *
 * @deprecated SSEClientTransport is deprecated in the official MCP SDK as of spec version 2025-11-25.
 * Use StreamableHttpConnectionManager instead, which provides the same SSE functionality
 * through a unified endpoint.
 *
 * **This class is maintained for backward compatibility** and will continue to work.
 *
 * Migration guide:
 * ```typescript
 * // Old (still works, but deprecated)
 * import { SseConnectionManager } from 'mcp-use';
 * const manager = new SseConnectionManager(url);
 *
 * // New (recommended)
 * import { StreamableHttpConnectionManager } from 'mcp-use';
 * const manager = new StreamableHttpConnectionManager(url);
 * ```
 *
 * **Important:** StreamableHTTP still supports SSE for notifications - it just uses
 * a single /mcp endpoint instead of separate POST and SSE endpoints. No functionality is lost.
 *
 * @see https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http
 * @see StreamableHttpConnectionManager for the recommended alternative
 */

// Suppress TypeScript warning - SSEClientTransport is deprecated in SDK but we maintain it for backward compat
// @ts-ignore - We're aware of the deprecation and handle it with our own @deprecated tag above
import type { SSEClientTransportOptions } from "@mcp-use/modelcontextprotocol-sdk/client/sse.js";
// @ts-ignore
import { SSEClientTransport } from "@mcp-use/modelcontextprotocol-sdk/client/sse.js";
import type { JSONRPCMessage } from "@mcp-use/modelcontextprotocol-sdk/types.js";
import { logger } from "../logging.js";
import { ConnectionManager } from "./base.js";

export class SseConnectionManager extends ConnectionManager<SSEClientTransport> {
  private readonly url: URL;
  private readonly opts?: SSEClientTransportOptions;
  private _transport: SSEClientTransport | null = null;
  private reinitializing = false;

  /**
   * Create an SSE connection manager.
   *
   * @param url  The SSE endpoint URL.
   * @param opts Optional transport options (auth, headers, etc.).
   */
  constructor(url: string | URL, opts?: SSEClientTransportOptions) {
    super();
    this.url = typeof url === "string" ? new URL(url) : url;
    this.opts = opts;
  }

  /**
   * Spawn a new `SSEClientTransport` and wrap it with 404 handling.
   * Per MCP spec, clients MUST re-initialize when receiving 404 for stale sessions.
   */
  protected async establishConnection(): Promise<SSEClientTransport> {
    const transport = new SSEClientTransport(this.url, this.opts);

    // Wrap the send method to handle 404 session errors per MCP spec
    const originalSend = transport.send.bind(transport);
    transport.send = async (
      message: JSONRPCMessage | JSONRPCMessage[]
    ): Promise<void> => {
      // Helper to send message(s) - handles both single and array
      // Always returns void to match the expected signature
      const sendMessage = async (
        msg: JSONRPCMessage | JSONRPCMessage[]
      ): Promise<void> => {
        if (Array.isArray(msg)) {
          // If it's an array, send each message individually
          for (const singleMsg of msg) {
            await originalSend(singleMsg);
          }
        } else {
          await originalSend(msg);
        }
      };

      try {
        await sendMessage(message);
      } catch (error: any) {
        // Per MCP spec: When client receives 404 with session ID, MUST re-initialize
        // See: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management
        if (
          error?.code === 404 &&
          (transport as any).sessionId &&
          !this.reinitializing
        ) {
          logger.warn(
            `[SSE] Session not found (404), re-initializing per MCP spec...`
          );
          this.reinitializing = true;

          try {
            // Clear stale session ID
            (transport as any).sessionId = undefined;

            // Re-initialize: send new initialize request without session ID
            await this.reinitialize(transport);

            logger.info(`[SSE] Re-initialization successful, retrying request`);

            // Retry the original message with new session
            await sendMessage(message);
          } finally {
            this.reinitializing = false;
          }
        } else {
          throw error;
        }
      }
    };

    this._transport = transport;
    logger.debug(`${this.constructor.name} connected successfully`);
    return transport;
  }

  /**
   * Re-initialize the transport with a new session
   * This is called when the server returns 404 for a stale session
   */
  private async reinitialize(transport: SSEClientTransport): Promise<void> {
    // The official SDK doesn't expose a reinitialize method, but clearing the
    // sessionId and making a request will trigger a new initialize automatically
    logger.debug(`[SSE] Re-initialization triggered`);
  }

  /**
   * Close the underlying transport and clean up resources.
   */
  protected async closeConnection(
    _connection: SSEClientTransport
  ): Promise<void> {
    if (this._transport) {
      try {
        await this._transport.close();
      } catch (e) {
        logger.warn(`Error closing SSE transport: ${e}`);
      } finally {
        this._transport = null;
      }
    }
  }
}
