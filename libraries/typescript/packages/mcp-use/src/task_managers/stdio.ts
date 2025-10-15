import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Writable } from 'node:stream'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { logger } from '../logging.js'
import { ConnectionManager } from './base.js'

export class StdioConnectionManager extends ConnectionManager<StdioClientTransport> {
  private readonly serverParams: StdioServerParameters
  private readonly errlog: Writable
  private _transport: StdioClientTransport | null = null

  /**
   * Create a new stdio connection manager.
   *
   * @param serverParams Parameters for the stdio server process.
   * @param errlog       Stream to which the server's stderr should be piped.
   *                     Defaults to `process.stderr`.
   */
  constructor(serverParams: StdioServerParameters, errlog: Writable = process.stderr) {
    super()
    this.serverParams = serverParams
    this.errlog = errlog
  }

  /**
   * Establish the stdio connection by spawning the server process and starting
   * the SDK's transport. Returns the live `StdioClientTransport` instance.
   */
  protected async establishConnection(): Promise<StdioClientTransport> {
    // Instantiate and start the transport
    this._transport = new StdioClientTransport(this.serverParams)

    // If stderr was piped, forward it to `errlog` for visibility
    if (this._transport.stderr && typeof (this._transport.stderr as any).pipe === 'function') {
      (this._transport.stderr as unknown as NodeJS.ReadableStream).pipe(this.errlog)
    }

    logger.debug(`${this.constructor.name} connected successfully`)
    return this._transport
  }

  /**
   * Close the stdio connection, making sure the transport cleans up the child
   * process and associated resources.
   */
  protected async closeConnection(_connection: StdioClientTransport): Promise<void> {
    if (this._transport) {
      try {
        await this._transport.close()
      }
      catch (e) {
        logger.warn(`Error closing stdio transport: ${e}`)
      }
      finally {
        this._transport = null
      }
    }
  }
}
