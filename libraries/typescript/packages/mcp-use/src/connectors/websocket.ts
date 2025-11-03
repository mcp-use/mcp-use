import type {
  CallToolResult,
  ReadResourceResult,
  Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { v4 as uuidv4 } from 'uuid'
import { logger } from '../logging.js'
import { WebSocketConnectionManager } from '../task_managers/websocket.js'

import { BaseConnector } from './base.js'

export interface WebSocketConnectorOptions {
  authToken?: string
  headers?: Record<string, string>
}

export class WebSocketConnector extends BaseConnector {
  private readonly url: string
  private readonly headers: Record<string, string>

  protected connectionManager: WebSocketConnectionManager | null = null
  private ws: WebSocket | import('ws').WebSocket | null = null
  private receiverTask: Promise<void> | null = null
  private pending: Map<string, { resolve: (v: any) => void, reject: (e: any) => void }>
    = new Map()

  protected toolsCache: Tool[] | null = null

  constructor(url: string, opts: WebSocketConnectorOptions = {}) {
    super()
    this.url = url
    this.headers = { ...(opts.headers ?? {}) }
    if (opts.authToken)
      this.headers.Authorization = `Bearer ${opts.authToken}`
  }

  async connect(): Promise<void> {
    if (this.connected) {
      logger.debug('Already connected to MCP implementation')
      return
    }

    logger.debug(`Connecting via WebSocket: ${this.url}`)
    try {
      this.connectionManager = new WebSocketConnectionManager(this.url, this.headers)
      this.ws = await this.connectionManager.start()
      this.receiverTask = this.receiveLoop()
      this.connected = true
      logger.debug('WebSocket connected successfully')
    }
    catch (e) {
      logger.error(`Failed to connect: ${e}`)
      await this.cleanupResources()
      throw e
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      logger.debug('Not connected to MCP implementation')
      return
    }
    logger.debug('Disconnecting …')
    await this.cleanupResources()
    this.connected = false
  }

  private sendRequest<T = any>(method: string, params: Record<string, any> | null = null): Promise<T> {
    if (!this.ws)
      throw new Error('WebSocket is not connected')
    const id = uuidv4()
    const payload = JSON.stringify({ id, method, params: params ?? {} })

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      (this.ws as any).send(payload, (err?: Error) => {
        if (err) {
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  private async receiveLoop(): Promise<void> {
    if (!this.ws)
      return

    const socket = this.ws as any // Node.ws or browser WS
    const onMessage = (msg: any) => {
      let data: any
      try {
        data = JSON.parse(msg.data ?? msg)
      }
      catch (e) {
        logger.warn('Received non‑JSON frame', e)
        return
      }
      const id = data.id
      if (id && this.pending.has(id)) {
        const { resolve, reject } = this.pending.get(id)!
        this.pending.delete(id)
        if ('result' in data)
          resolve(data.result)
        else if ('error' in data)
          reject(data.error)
      }
      else {
        logger.debug('Received unsolicited message', data)
      }
    }

    if (socket.addEventListener) {
      socket.addEventListener('message', onMessage)
    } else {
      socket.on('message', onMessage)
    }

    // keep promise pending until close
    return new Promise<void>((resolve) => {
      const onClose = () => {
        if (socket.removeEventListener) {
          socket.removeEventListener('message', onMessage)
        } else {
          socket.off('message', onMessage)
        }
        this.rejectAll(new Error('WebSocket closed'))
        resolve()
      }
      if (socket.addEventListener) {
        socket.addEventListener('close', onClose)
      } else {
        socket.on('close', onClose)
      }
    })
  }

  private rejectAll(err: Error) {
    for (const { reject } of this.pending.values()) reject(err)
    this.pending.clear()
  }

  async initialize(): Promise<Record<string, any>> {
    logger.debug('Initializing MCP session over WebSocket')
    const result = await this.sendRequest<Record<string, any>>('initialize')
    const toolsList = await this.listTools()
    this.toolsCache = toolsList.map(t => t as Tool)
    logger.debug(`Initialized with ${this.toolsCache.length} tools`)
    return result
  }

  async listTools(): Promise<Tool[]> {
    const res = await this.sendRequest<{ tools: Tool[] }>('tools/list')
    return res.tools ?? []
  }

  async callTool(name: string, args: Record<string, any>): Promise<CallToolResult> {
    return await this.sendRequest('tools/call', { name, arguments: args })
  }

  async listResources(): Promise<any> {
    const resources = await this.sendRequest('resources/list')
    return { resources: Array.isArray(resources) ? resources : [] }
  }

  async readResource(uri: string): Promise<ReadResourceResult> {
    const res = await this.sendRequest('resources/read', { uri })
    return res
  }

  async request(method: string, params: Record<string, any> | null = null): Promise<any> {
    return await this.sendRequest(method, params)
  }

  get tools(): Tool[] {
    if (!this.toolsCache)
      throw new Error('MCP client is not initialized')
    return this.toolsCache
  }

  protected async cleanupResources(): Promise<void> {
    // Stop receiver
    if (this.receiverTask)
      await this.receiverTask.catch(() => {})
    this.receiverTask = null

    // Reject pending
    this.rejectAll(new Error('WebSocket disconnected'))

    // Stop connection manager → closes socket
    if (this.connectionManager) {
      await this.connectionManager.stop()
      this.connectionManager = null
      this.ws = null
    }

    this.toolsCache = null
  }

  get publicIdentifier(): Record<string, string> {
    return {
      type: 'websocket',
      url: this.url,
    }
  }
}
