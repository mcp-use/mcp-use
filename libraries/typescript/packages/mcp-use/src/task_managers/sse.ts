import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { logger } from '../logging.js'
import { ConnectionManager } from './base.js'

export class SseConnectionManager extends ConnectionManager<SSEClientTransport> {
  private readonly url: URL
  private readonly opts?: SSEClientTransportOptions
  private _transport: SSEClientTransport | null = null

  /**
   * Create an SSE connection manager.
   *
   * @param url  The SSE endpoint URL.
   * @param opts Optional transport options (auth, headers, etc.).
   */
  constructor(url: string | URL, opts?: SSEClientTransportOptions) {
    super()
    this.url = typeof url === 'string' ? new URL(url) : url
    this.opts = opts
  }

  /**
   * Spawn a new `SSEClientTransport` and start the connection.
   */
  protected async establishConnection(): Promise<SSEClientTransport> {
    this._transport = new SSEClientTransport(this.url, this.opts)

    logger.debug(`${this.constructor.name} connected successfully`)
    return this._transport
  }

  /**
   * Close the underlying transport and clean up resources.
   */
  protected async closeConnection(_connection: SSEClientTransport): Promise<void> {
    if (this._transport) {
      try {
        await this._transport.close()
      }
      catch (e) {
        logger.warn(`Error closing SSE transport: ${e}`)
      }
      finally {
        this._transport = null
      }
    }
  }
}
