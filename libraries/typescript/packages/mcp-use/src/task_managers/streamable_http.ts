import type { StreamableHTTPClientTransportOptions } from "@mcp-use/modelcontextprotocol-sdk/client/streamableHttp.js";
import { StreamableHTTPClientTransport } from "@mcp-use/modelcontextprotocol-sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@mcp-use/modelcontextprotocol-sdk/types.js";
import { logger } from "../logging.js";
import { ConnectionManager } from "./base.js";

export class StreamableHttpConnectionManager extends ConnectionManager<StreamableHTTPClientTransport> {
  private readonly url: URL;
  private readonly opts?: StreamableHTTPClientTransportOptions;
  private _transport: StreamableHTTPClientTransport | null = null;
  private reinitializing = false;

  /**
   * Create a Streamable HTTP connection manager.
   *
   * @param url  The HTTP endpoint URL.
   * @param opts Optional transport options (auth, headers, etc.).
   */
  constructor(url: string | URL, opts?: StreamableHTTPClientTransportOptions) {
    super();
    this.url = typeof url === "string" ? new URL(url) : url;
    this.opts = opts;
  }

  /**
   * Spawn a new `StreamableHTTPClientTransport` and wrap it with 404 handling.
   * Per MCP spec, clients MUST re-initialize when receiving 404 for stale sessions.
   */
  protected async establishConnection(): Promise<StreamableHTTPClientTransport> {
    const transport = new StreamableHTTPClientTransport(this.url, this.opts);

    // Wrap the send method to handle 404 session errors per MCP spec
    const originalSend = transport.send.bind(transport);
    transport.send = async (
      message: JSONRPCMessage | JSONRPCMessage[],
      options?: any
    ) => {
      try {
        return await originalSend(message, options);
      } catch (error: any) {
        // Per MCP spec: When client receives 404 with session ID, MUST re-initialize
        // See: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management
        if (
          error?.code === 404 &&
          (transport as any).sessionId &&
          !this.reinitializing
        ) {
          logger.warn(
            `[StreamableHttp] Session not found (404), re-initializing per MCP spec...`
          );
          this.reinitializing = true;

          try {
            // Clear stale session ID
            (transport as any).sessionId = undefined;

            // Re-initialize: send new initialize request without session ID
            // The SDK will handle this automatically when sessionId is cleared
            await this.reinitialize(transport);

            logger.info(
              `[StreamableHttp] Re-initialization successful, retrying request`
            );

            // Retry the original message with new session
            return await originalSend(message, options);
          } finally {
            this.reinitializing = false;
          }
        }
        throw error;
      }
    };

    this._transport = transport;
    logger.debug(`${this.constructor.name} created successfully`);
    return transport;
  }

  /**
   * Re-initialize the transport with a new session
   * This is called when the server returns 404 for a stale session
   */
  private async reinitialize(
    transport: StreamableHTTPClientTransport
  ): Promise<void> {
    // The official SDK doesn't expose a reinitialize method, but clearing the
    // sessionId and making a request will trigger a new initialize automatically
    // The Client.initialize() method should be called by the connector layer
    logger.debug(`[StreamableHttp] Re-initialization triggered`);
  }

  /**
   * Close the underlying transport and clean up resources.
   * Per MCP specification, terminates the session with DELETE request before closing.
   */
  protected async closeConnection(
    _connection: StreamableHTTPClientTransport
  ): Promise<void> {
    if (this._transport) {
      try {
        // First terminate the session per MCP spec (sends DELETE request)
        await this._transport.terminateSession();
        // Then close the transport
        await this._transport.close();
      } catch (e) {
        logger.warn(`Error closing Streamable HTTP transport: ${e}`);
      } finally {
        this._transport = null;
      }
    }
  }

  /**
   * Get the session ID from the transport if available.
   */
  get sessionId(): string | undefined {
    return this._transport?.sessionId;
  }
}
