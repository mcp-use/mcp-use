import type { StructuredToolInterface } from '@langchain/core/tools'
import type { BaseConnector } from '../../connectors/base.js'
import type { ServerManager } from '../server_manager.js'
import type { SchemaOutputT } from './base.js'
import { z } from 'zod'
import { logger } from '../../logging.js'
import { MCPServerTool } from './base.js'

const ConnectMCPServerSchema = z.object({
  serverName: z.string().describe('The name of the MCP server.'),
})

export class ConnectMCPServerTool extends MCPServerTool<typeof ConnectMCPServerSchema> {
  override name = 'connect_to_mcp_server'
  override description = 'Connect to a specific MCP (Model Context Protocol) server to use its tools. Use this tool to connect to a specific server and use its tools.'
  override schema = ConnectMCPServerSchema

  constructor(manager: ServerManager) {
    super(manager)
  }

  async _call({ serverName }: SchemaOutputT<typeof ConnectMCPServerSchema>) {
    const serverNames = this.manager.client.getServerNames()

    if (!serverNames.includes(serverName)) {
      const available = serverNames.length > 0 ? serverNames.join(', ') : 'none'
      return `Server '${serverName}' not found. Available servers: ${available}`
    }

    if (this.manager.activeServer === serverName) {
      return `Already connected to MCP server '${serverName}'`
    }

    try {
      let session = this.manager.client.getSession(serverName)
      logger.debug(`Using existing session for server '${serverName}'`)
      if (!session) {
        logger.debug(`Creating new session for server '${serverName}'`)
        session = await this.manager.client.createSession(serverName)
      }
      this.manager.activeServer = serverName
      if (this.manager.serverTools[serverName]) {
        const connector: BaseConnector = session.connector
        const tools: StructuredToolInterface[] = await this.manager.adapter.createToolsFromConnectors([connector])
        this.manager.serverTools[serverName] = tools
        this.manager.initializedServers[serverName] = true
      }
      const serverTools: StructuredToolInterface[] = this.manager.serverTools[serverName] || []
      const numTools: number = serverTools.length
      return `Connected to MCP server '${serverName}'. ${numTools} tools are now available.`
    }
    catch (error) {
      logger.error(`Error connecting to server '${serverName}': ${String(error)}`)
      return `Failed to connect to server '${serverName}': ${String(error)}`
    }
  }
}
