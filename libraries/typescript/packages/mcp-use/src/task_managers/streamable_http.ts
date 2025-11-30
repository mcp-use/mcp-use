import type { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "../logging.js";
import { ConnectionManager } from "./base.js";

export class StreamableHttpConnectionManager extends ConnectionManager<StreamableHTTPClientTransport> {
  private readonly url: URL;
  private readonly opts?: StreamableHTTPClientTransportOptions;
  private _transport: StreamableHTTPClientTransport | null = null;

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
   * Spawn a new `StreamableHTTPClientTransport` and return it.
   * The Client.connect() method will handle starting the transport.
   */
  protected async establishConnection(): Promise<StreamableHTTPClientTransport> {
    this._transport = new StreamableHTTPClientTransport(this.url, this.opts);

    logger.debug(`${this.constructor.name} created successfully`);
    return this._transport;
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
