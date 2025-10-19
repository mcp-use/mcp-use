import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { logger } from '../logging.js'
import { SseConnectionManager } from '../task_managers/sse.js'
import { StreamableHttpConnectionManager } from '../task_managers/streamable_http.js'
import type { ConnectorInitOptions } from './base.js'
import { BaseConnector } from './base.js'

export interface HttpConnectorOptions extends ConnectorInitOptions {
  authToken?: string
  headers?: Record<string, string>
  timeout?: number // HTTP request timeout (ms)
  sseReadTimeout?: number // SSE read timeout (ms)
  clientInfo?: { name: string, version: string }
  preferSse?: boolean // Force SSE transport instead of trying streamable HTTP first
}

export class HttpConnector extends BaseConnector {
  private readonly baseUrl: string
  private readonly headers: Record<string, string>
  private readonly timeout: number
  private readonly sseReadTimeout: number
  private readonly clientInfo: { name: string, version: string }
  private readonly preferSse: boolean
  private transportType: 'streamable-http' | 'sse' | null = null

  constructor(baseUrl: string, opts: HttpConnectorOptions = {}) {
    super(opts)

    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.headers = { ...(opts.headers ?? {}) }
    if (opts.authToken) {
      this.headers.Authorization = `Bearer ${opts.authToken}`
    }

    this.timeout = opts.timeout ?? 30000 // Default 30 seconds
    this.sseReadTimeout = opts.sseReadTimeout ?? 300000 // Default 5 minutes
    this.clientInfo = opts.clientInfo ?? { name: 'http-connector', version: '1.0.0' }
    this.preferSse = opts.preferSse ?? false
  }

  /** Establish connection to the MCP implementation via HTTP (streamable or SSE). */
  async connect(): Promise<void> {
    if (this.connected) {
      logger.debug('Already connected to MCP implementation')
      return
    }

    const baseUrl = this.baseUrl

    // If preferSse is set, skip directly to SSE
    if (this.preferSse) {
      logger.debug(`Connecting to MCP implementation via HTTP/SSE: ${baseUrl}`)
      await this.connectWithSse(baseUrl)
      return
    }

    // Try streamable HTTP first, then fall back to SSE
    logger.debug(`Connecting to MCP implementation via HTTP: ${baseUrl}`)

    try {
      // Try streamable HTTP transport first
      logger.info('🔄 Attempting streamable HTTP transport...')
      await this.connectWithStreamableHttp(baseUrl)
      logger.info('✅ Successfully connected via streamable HTTP')
    }
    catch (err) {
      // Check if this is a 4xx error that indicates we should try SSE fallback
      let fallbackReason = 'Unknown error'

      if (err instanceof StreamableHTTPError) {
        // Check for "Missing session ID" error (HTTP 400 from FastMCP)
        if (err.code === 400 && err.message.includes('Missing session ID')) {
          fallbackReason = 'Server requires session ID (FastMCP compatibility) - using SSE transport'
          logger.warn(`⚠️  ${fallbackReason}`)
        }
        else if (err.code === 404 || err.code === 405) {
          fallbackReason = `Server returned ${err.code} - server likely doesn't support streamable HTTP`
          logger.debug(fallbackReason)
        }
        else {
          fallbackReason = `Server returned ${err.code}: ${err.message}`
          logger.debug(fallbackReason)
        }
      }
      else if (err instanceof Error) {
        // Check for 404/405 in error message as fallback detection
        const errorStr = err.toString()
        const errorMsg = err.message || ''
        
        // Check for "Missing session ID" error in the message (from both direct errors and wrapped errors)
        if (errorStr.includes('Missing session ID') 
            || errorStr.includes('Bad Request: Missing session ID')
            || errorMsg.includes('FastMCP session ID error')) {
          fallbackReason = 'Server requires session ID (FastMCP compatibility) - using SSE transport'
          logger.warn(`⚠️  ${fallbackReason}`)
        }
        else if (errorStr.includes('405 Method Not Allowed') || errorStr.includes('404 Not Found')) {
          fallbackReason = 'Server doesn\'t support streamable HTTP (405/404)'
          logger.debug(fallbackReason)
        }
        else {
          fallbackReason = `Streamable HTTP failed: ${err.message}`
          logger.debug(fallbackReason)
        }
      }

      // Always try SSE fallback for maximum compatibility
      logger.info('🔄 Falling back to SSE transport...')

      try {
        await this.connectWithSse(baseUrl)
      }
      catch (sseErr) {
        logger.error(`Failed to connect with both transports:`)
        logger.error(`  Streamable HTTP: ${fallbackReason}`)
        logger.error(`  SSE: ${sseErr}`)
        await this.cleanupResources()
        throw new Error('Could not connect to server with any available transport')
      }
    }
  }

  private async connectWithStreamableHttp(baseUrl: string): Promise<void> {
    try {
      // Create and start the streamable HTTP connection manager
      this.connectionManager = new StreamableHttpConnectionManager(
        baseUrl,
        {
          requestInit: {
            headers: this.headers,
          },
          // Pass through timeout and other options
          reconnectionOptions: {
            maxReconnectionDelay: 30000,
            initialReconnectionDelay: 1000,
            reconnectionDelayGrowFactor: 1.5,
            maxRetries: 2,
          },
        },
      )
      const transport = await this.connectionManager.start()

      // Create and connect the client
      // This performs both initialize AND initialized notification
      this.client = new Client(this.clientInfo, this.opts.clientOptions)
      
      try {
        await this.client.connect(transport)
      }
      catch (connectErr) {
        // Check if the error is due to missing session ID during connection handshake
        if (connectErr instanceof Error) {
          const errMsg = connectErr.message || connectErr.toString()
          if (errMsg.includes('Missing session ID') || errMsg.includes('Bad Request: Missing session ID')) {
            // Wrap it in a more specific error so the outer catch can detect it
            const wrappedError = new Error(`FastMCP session ID error: ${errMsg}`)
            wrappedError.cause = connectErr
            throw wrappedError
          }
        }
        throw connectErr
      }

      this.connected = true
      this.transportType = 'streamable-http'
      logger.debug(`Successfully connected to MCP implementation via streamable HTTP: ${baseUrl}`)
    }
    catch (err) {
      // Clean up partial resources before throwing
      await this.cleanupResources()
      throw err
    }
  }

  private async connectWithSse(baseUrl: string): Promise<void> {
    try {
      // Create and start the SSE connection manager
      // Note: The MCP SDK's SSEClientTransport doesn't expose timeout configuration directly
      // Timeout handling is managed by the underlying EventSource and fetch implementations
      this.connectionManager = new SseConnectionManager(
        baseUrl,
        {
          requestInit: {
            headers: this.headers,
          },
        },
      )
      const transport = await this.connectionManager.start()

      // Create and connect the client
      this.client = new Client(this.clientInfo, this.opts.clientOptions)
      await this.client.connect(transport)

      this.connected = true
      this.transportType = 'sse'
      logger.debug(`Successfully connected to MCP implementation via HTTP/SSE: ${baseUrl}`)
    }
    catch (err) {
      // Clean up partial resources before throwing
      await this.cleanupResources()
      throw err
    }
  }

  get publicIdentifier(): Record<string, string> {
    return {
      type: 'http',
      url: this.baseUrl,
      transport: this.transportType || 'unknown',
    }
  }

  /**
   * Get the transport type being used (streamable-http or sse)
   */
  getTransportType(): 'streamable-http' | 'sse' | null {
    return this.transportType
  }
}
