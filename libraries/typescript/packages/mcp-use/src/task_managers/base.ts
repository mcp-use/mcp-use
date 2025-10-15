import { logger } from '../logging.js'

export type ConnectionType<T = any> = T

export abstract class ConnectionManager<T = any> {
  private _readyPromise!: Promise<void>
  private _readyResolver!: () => void

  private _donePromise!: Promise<void>
  private _doneResolver!: () => void

  private _exception: Error | null = null
  private _connection: T | null = null
  private _task: Promise<void> | null = null
  private _abortController: AbortController | null = null

  constructor() {
    this.reset()
  }

  /**
   * Establish the connection.
   *
   * This method should be implemented by subclasses to establish the specific
   * type of connection needed.
   *
   * @returns The established connection.
   * @throws If the connection cannot be established.
   */
  protected abstract establishConnection(): Promise<T>

  /**
   * Close the connection.
   *
   * This method should be implemented by subclasses to close the specific type
   * of connection.
   *
   * @param connection The connection to close.
   */
  protected abstract closeConnection(connection: T): Promise<void>

  /**
   * Start the connection manager and establish a connection.
   *
   * @returns The established connection.
   * @throws If the connection cannot be established.
   */
  async start(): Promise<T> {
    // Reset internal state before starting
    this.reset()

    logger.debug(`Starting ${this.constructor.name}`)

    // Kick off the background task that manages the connection
    this._task = this.connectionTask()

    // Wait until the connection is ready or an error occurs
    await this._readyPromise

    // If an exception occurred during startup, re‑throw it
    if (this._exception) {
      throw this._exception
    }

    if (this._connection === null) {
      throw new Error('Connection was not established')
    }

    return this._connection
  }

  /**
   * Stop the connection manager and close the connection.
   */
  async stop(): Promise<void> {
    if (this._task && this._abortController) {
      logger.debug(`Cancelling ${this.constructor.name} task`)

      this._abortController.abort()

      try {
        await this._task
      }
      catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          logger.debug(`${this.constructor.name} task aborted successfully`)
        }
        else {
          logger.warn(`Error stopping ${this.constructor.name} task: ${e}`)
        }
      }
    }

    // Wait until the connection cleanup has completed
    await this._donePromise
    logger.debug(`${this.constructor.name} task completed`)
  }

  /**
   * Reset all internal state.
   */
  private reset(): void {
    this._readyPromise = new Promise(res => (this._readyResolver = res))
    this._donePromise = new Promise(res => (this._doneResolver = res))
    this._exception = null
    this._connection = null
    this._task = null
    this._abortController = new AbortController()
  }

  /**
   * The background task responsible for establishing and maintaining the
   * connection until it is cancelled.
   */
  private async connectionTask(): Promise<void> {
    logger.debug(`Running ${this.constructor.name} task`)

    try {
      // Establish the connection
      this._connection = await this.establishConnection()
      logger.debug(`${this.constructor.name} connected successfully`)

      // Signal that the connection is ready
      this._readyResolver()

      // Keep the task alive until it is cancelled
      await this.waitForAbort()
    }
    catch (err) {
      this._exception = err as Error
      logger.error(`Error in ${this.constructor.name} task: ${err}`)

      // Ensure the ready promise resolves so that start() can handle the error
      this._readyResolver()
    }
    finally {
      // Clean up the connection if it was established
      if (this._connection !== null) {
        try {
          await this.closeConnection(this._connection)
        }
        catch (closeErr) {
          logger.warn(`Error closing connection in ${this.constructor.name}: ${closeErr}`)
        }
        this._connection = null
      }

      // Signal that cleanup is finished
      this._doneResolver()
    }
  }

  /**
   * Helper that returns a promise which resolves when the abort signal fires.
   */
  private async waitForAbort(): Promise<void> {
    return new Promise((_resolve, _reject) => {
      if (!this._abortController) {
        return
      }

      const signal = this._abortController.signal

      if (signal.aborted) {
        _resolve()
        return
      }

      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort)
        _resolve()
      }

      signal.addEventListener('abort', onAbort)
    })
  }
}
