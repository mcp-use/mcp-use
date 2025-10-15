import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Writable } from 'node:stream'

import type { ConnectorInitOptions } from './base.js'
import process from 'node:process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { logger } from '../logging.js'
import { StdioConnectionManager } from '../task_managers/stdio.js'
import { BaseConnector } from './base.js'

export interface StdioConnectorOptions extends ConnectorInitOptions {
  clientInfo?: { name: string, version: string }
}

export class StdioConnector extends BaseConnector {
  private readonly command: string
  private readonly args: string[]
  private readonly env?: Record<string, string>
  private readonly errlog: Writable
  private readonly clientInfo: { name: string, version: string }

  constructor(
    {
      command = 'npx',
      args = [],
      env,
      errlog = process.stderr,
      ...rest
    }: {
      command?: string
      args?: string[]
      env?: Record<string, string>
      errlog?: Writable
    } & StdioConnectorOptions = {},
  ) {
    super(rest)

    this.command = command
    this.args = args
    this.env = env
    this.errlog = errlog
    this.clientInfo = rest.clientInfo ?? { name: 'stdio-connector', version: '1.0.0' }
  }

  /** Establish connection to the MCP implementation. */
  async connect(): Promise<void> {
    if (this.connected) {
      logger.debug('Already connected to MCP implementation')
      return
    }

    logger.debug(`Connecting to MCP implementation via stdio: ${this.command}`)
    try {
      // 1. Build server parameters for the transport

      // Merge env with process.env, filtering out undefined values
      let mergedEnv: Record<string, string> | undefined
      if (this.env) {
        mergedEnv = {}
        // First add process.env values (excluding undefined)
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) {
            mergedEnv[key] = value
          }
        }
        // Then override with provided env
        Object.assign(mergedEnv, this.env)
      }

      const serverParams: StdioServerParameters = {
        command: this.command,
        args: this.args,
        env: mergedEnv,
      }

      // 2. Start the connection manager -> returns a live transport
      this.connectionManager = new StdioConnectionManager(serverParams, this.errlog)
      const transport = await this.connectionManager.start()

      // 3. Create & connect the MCP client
      this.client = new Client(this.clientInfo, this.opts.clientOptions)
      await this.client.connect(transport)

      this.connected = true
      logger.debug(`Successfully connected to MCP implementation: ${this.command}`)
    }
    catch (err) {
      logger.error(`Failed to connect to MCP implementation: ${err}`)
      await this.cleanupResources()
      throw err
    }
  }

  get publicIdentifier(): Record<string, string> {
    return {
      'type': 'stdio',
      'command&args': `${this.command} ${this.args.join(' ')}`,
    }
  }
}
