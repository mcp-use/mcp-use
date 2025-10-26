import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ServerManager } from '../server_manager.js'
import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { logger } from '../../logging.js'

export class AddMCPServerFromConfigTool extends StructuredTool {
  name = 'add_mcp_server_from_config'
  description
    = 'Adds a new MCP server to the client from a configuration object and connects to it, making its tools available.'

  schema = z.object({
    serverName: z.string().describe('The name for the new MCP server.'),
    serverConfig: z
      .any()
      .describe(
        'The configuration object for the server. This should not include the top-level "mcpServers" key.',
      ),
  })

  private manager: ServerManager

  constructor(manager: ServerManager) {
    super()
    this.manager = manager
  }

  protected async _call({
    serverName,
    serverConfig,
  }: z.infer<typeof this.schema>): Promise<string> {
    try {
      this.manager.client.addServer(serverName, serverConfig)
      let result = `Server '${serverName}' added to the client.`
      logger.debug(
        `Connecting to new server '${serverName}' and discovering tools.`,
      )
      const session = await this.manager.client.createSession(serverName)
      const connector = session.connector
      const tools: StructuredToolInterface[]
          = await this.manager.adapter.createToolsFromConnectors([connector])

      this.manager.serverTools[serverName] = tools
      this.manager.initializedServers[serverName] = true
      this.manager.activeServer = serverName // Set as active server

      const numTools = tools.length
      result += ` Session created and connected. '${serverName}' is now the active server with ${numTools} tools available.`
      result += `\n\n${tools.map(t => t.name).join('\n')}`
      logger.info(result)
      return result
    }
    catch (e: any) {
      logger.error(
        `Failed to add or connect to server '${serverName}': ${e.message}`,
      )
      return `Failed to add or connect to server '${serverName}': ${e.message}`
    }
  }
}
