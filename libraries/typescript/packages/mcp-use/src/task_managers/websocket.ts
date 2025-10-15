import WS from 'ws'
import { logger } from '../logging.js'
import { ConnectionManager } from './base.js'

export type IWebSocket = WS

export class WebSocketConnectionManager extends ConnectionManager<IWebSocket> {
  private readonly url: string
  private readonly headers: Record<string, string>
  private _ws: IWebSocket | null = null

  /**
   * @param url     The WebSocket URL to connect to.
   * @param headers Optional headers to include in the connection handshake.
   */
  constructor(url: string, headers: Record<string, string> = {}) {
    super()
    this.url = url
    this.headers = headers
  }

  /** Establish a WebSocket connection and wait until it is open. */
  protected async establishConnection(): Promise<IWebSocket> {
    logger.debug(`Connecting to WebSocket: ${this.url}`)

    return new Promise<IWebSocket>((resolve, reject) => {
      const ws: IWebSocket = new WS(this.url, { headers: this.headers }) as IWebSocket
      this._ws = ws

      const onOpen = () => {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        cleanup()
        logger.debug('WebSocket connected successfully')
        resolve(ws)
      }

      const onError = (err: Error) => {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        cleanup()
        logger.error(`Failed to connect to WebSocket: ${err}`)
        reject(err)
      }

      const cleanup = () => {
        ws.off('open', onOpen)
        ws.off('error', onError)
      }

      // Register listeners (browser vs Node API differences handled)
      ws.on('open', onOpen)
      ws.on('error', onError)
    })
  }

  /** Cleanly close the WebSocket connection. */
  protected async closeConnection(connection: IWebSocket): Promise<void> {
    logger.debug('Closing WebSocket connection')

    return new Promise((resolve) => {
      const onClose = () => {
        connection.off('close', onClose)
        this._ws = null
        resolve()
      }

      if (connection.readyState === WS.CLOSED) {
        onClose()
        return
      }

      connection.on('close', onClose)

      try {
        connection.close()
      }
      catch (e) {
        logger.warn(`Error closing WebSocket connection: ${e}`)
        onClose()
      }
    })
  }
}
