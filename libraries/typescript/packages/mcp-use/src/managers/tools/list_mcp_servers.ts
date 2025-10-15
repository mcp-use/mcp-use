import type { ServerManager } from '../server_manager.js'
import { z } from 'zod'
import { logger } from '../../logging.js'
import { MCPServerTool } from './base.js'

const EnumerateServersSchema = z.object({})

export class ListMCPServersTool extends MCPServerTool<typeof EnumerateServersSchema> {
  override name = 'list_mcp_servers'
  override description = `Lists all available MCP (Model Context Protocol) servers that can be connected to, along with the tools available on each server. Use this tool to discover servers and see what functionalities they offer.`
  override schema = EnumerateServersSchema

  constructor(manager: ServerManager) {
    super(manager)
  }

  async _call(): Promise<string> {
    const serverNames = this.manager.client.getServerNames()
    if (serverNames.length === 0) {
      return `No MCP servers are currently defined.`
    }

    const outputLines: string[] = ['Available MCP servers:']

    for (const serverName of serverNames) {
      const isActiveServer = serverName === this.manager.activeServer
      const activeFlag = isActiveServer ? ' (ACTIVE)' : ''
      outputLines.push(`- ${serverName}${activeFlag}`)

      try {
        const serverTools = this.manager.serverTools?.[serverName] ?? []
        const numberOfTools = Array.isArray(serverTools) ? serverTools.length : 0
        outputLines.push(`${numberOfTools} tools available for this server\n`)
      }
      catch (error) {
        logger.error(`Unexpected error listing tools for server '${serverName}': ${String(error)}`)
      }
    }
    return outputLines.join('\n')
  }
}
