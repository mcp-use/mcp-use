import type { ServerManager } from '../server_manager.js'
import { z } from 'zod'
import { MCPServerTool } from './base.js'

const PresentActiveServerSchema = z.object({})

export class AcquireActiveMCPServerTool extends MCPServerTool<typeof PresentActiveServerSchema> {
  override name = 'get_active_mcp_server'
  override description = 'Get the currently active MCP (Model Context Protocol) server'
  override schema = PresentActiveServerSchema

  constructor(manager: ServerManager) {
    super(manager)
  }

  async _call(): Promise<string> {
    if (!this.manager.activeServer) {
      return `No MCP server is currently active. Use connect_to_mcp_server to connect to a server.`
    }

    return `Currently active MCP server: ${this.manager.activeServer}`
  }
}
