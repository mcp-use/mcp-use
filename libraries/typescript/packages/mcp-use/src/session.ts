import type { BaseConnector } from './connectors/base.js'

export class MCPSession {
  readonly connector: BaseConnector
  private autoConnect: boolean

  constructor(connector: BaseConnector, autoConnect = true) {
    this.connector = connector
    this.autoConnect = autoConnect
  }

  async connect(): Promise<void> {
    await this.connector.connect()
  }

  async disconnect(): Promise<void> {
    await this.connector.disconnect()
  }

  async initialize(): Promise<void> {
    if (!this.isConnected && this.autoConnect) {
      await this.connect()
    }
    await this.connector.initialize()
  }

  get isConnected(): boolean {
    return this.connector && this.connector.isClientConnected
  }
}
