import type { BaseConnector } from './connectors/base.js'
import fs from 'node:fs'
import path from 'node:path'
import { BaseMCPClient } from './client/base.js'
import { createConnectorFromConfig, loadConfigFile } from './config.js'

/**
 * Node.js-specific MCPClient implementation
 *
 * Extends the base client with Node.js-specific features like:
 * - File system operations (saveConfig)
 * - Config file loading (fromConfigFile)
 * - All connector types including StdioConnector
 */
export class MCPClient extends BaseMCPClient {
  constructor(config?: string | Record<string, any>) {
    if (config) {
      if (typeof config === 'string') {
        super(loadConfigFile(config))
      }
      else {
        super(config)
      }
    }
    else {
      super()
    }
  }

  public static fromDict(cfg: Record<string, any>): MCPClient {
    return new MCPClient(cfg)
  }

  public static fromConfigFile(path: string): MCPClient {
    return new MCPClient(loadConfigFile(path))
  }

  /**
   * Save configuration to a file (Node.js only)
   */
  public saveConfig(filepath: string): void {
    const dir = path.dirname(filepath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filepath, JSON.stringify(this.config, null, 2), 'utf-8')
  }

  /**
   * Create a connector from server configuration (Node.js version)
   * Supports all connector types including StdioConnector
   */
  protected createConnectorFromConfig(serverConfig: Record<string, any>): BaseConnector {
    return createConnectorFromConfig(serverConfig)
  }
}
