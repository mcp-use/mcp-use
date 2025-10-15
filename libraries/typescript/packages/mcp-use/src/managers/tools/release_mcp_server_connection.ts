import type { ServerManager } from '../server_manager.js'
import { z } from 'zod'
import { MCPServerTool } from './base.js'

const ReleaseConnectionSchema = z.object({})

export class ReleaseMCPServerConnectionTool extends MCPServerTool<typeof ReleaseConnectionSchema> {
  override name = 'disconnect_from_mcp_server'
  override description = 'Disconnect from the currently active MCP (Model Context Protocol) server'
  override schema = ReleaseConnectionSchema

  constructor(manager: ServerManager) {
    super(manager)
  }

  async _call(): Promise<string> {
    if (!this.manager.activeServer) {
      return `No MCP server is currently active, so there's nothing to disconnect from.`
    }
    const serverName = this.manager.activeServer
    this.manager.activeServer = null
    return `Successfully disconnected from MCP server '${serverName}'.`
  }
}
