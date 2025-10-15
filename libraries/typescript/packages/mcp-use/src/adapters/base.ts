import type { MCPClient } from '../client.js'
import type { BaseConnector } from '../connectors/base.js'
import { logger } from '../logging.js'

/**
 * Abstract base class for converting MCP tools to other framework formats.
 *
 * This class defines the common interface that all adapter implementations
 * should follow to ensure consistency across different frameworks.
 */
export abstract class BaseAdapter<T> {
  /**
   * List of tool names that should not be available.
   */
  protected readonly disallowedTools: string[]

  /**
   * Internal cache that maps a connector instance to the list of tools
   * generated for it.
   */
  private readonly connectorToolMap: Map<BaseConnector, T[]> = new Map()

  constructor(disallowedTools?: string[]) {
    this.disallowedTools = disallowedTools ?? []
  }

  /**
   * Create tools from an MCPClient instance.
   *
   * This is the recommended way to create tools from an MCPClient, as it handles
   * session creation and connector extraction automatically.
   *
   * @param client          The MCPClient to extract tools from.
   * @param disallowedTools Optional list of tool names to exclude.
   * @returns               A promise that resolves with a list of converted tools.
   */
  static async createTools<TTool, TAdapter extends BaseAdapter<TTool>>(
    this: new (disallowedTools?: string[]) => TAdapter,
    client: MCPClient,
    disallowedTools?: string[],
  ): Promise<TTool[]> {
    // Create the adapter
    const adapter = new this(disallowedTools)

    // Ensure we have active sessions
    if (!client.activeSessions || Object.keys(client.activeSessions).length === 0) {
      logger.info('No active sessions found, creating new ones...')
      await client.createAllSessions()
    }

    // Get all active sessions
    const sessions = client.getAllActiveSessions()

    // Extract connectors from sessions
    const connectors: BaseConnector[] = Object.values(sessions).map(
      session => session.connector,
    )

    // Create tools from connectors
    return adapter.createToolsFromConnectors(connectors)
  }

  /**
   * Dynamically load tools for a specific connector.
   *
   * @param connector The connector to load tools for.
   * @returns         The list of tools that were loaded in the target framework's format.
   */
  async loadToolsForConnector(connector: BaseConnector): Promise<T[]> {
    // Return cached tools if we already processed this connector
    if (this.connectorToolMap.has(connector)) {
      const cached = this.connectorToolMap.get(connector)!
      logger.debug(`Returning ${cached.length} existing tools for connector`)
      return cached
    }

    const connectorTools: T[] = []

    // Make sure the connector is initialized and has tools
    const success = await this.ensureConnectorInitialized(connector)
    if (!success) {
      return []
    }

    // Convert and collect tools
    for (const tool of connector.tools) {
      const converted = this.convertTool(tool, connector)
      if (converted) {
        connectorTools.push(converted)
      }
    }

    // Cache the tools for this connector
    this.connectorToolMap.set(connector, connectorTools)

    // Log for debugging purposes
    logger.debug(
      `Loaded ${connectorTools.length} new tools for connector: ${connectorTools
        .map((t: any) => t?.name ?? String(t))
        .join(', ')}`,
    )

    return connectorTools
  }

  /**
   * Convert an MCP tool to the target framework's tool format.
   *
   * @param mcpTool   The MCP tool definition to convert.
   * @param connector The connector that provides this tool.
   * @returns         The converted tool, or null / undefined if no tool should be produced.
   */
  protected abstract convertTool(
    mcpTool: Record<string, any>,
    connector: BaseConnector
  ): T | null | undefined

  /**
   * Create tools from MCP tools in all provided connectors.
   *
   * @param connectors List of MCP connectors to create tools from.
   * @returns         A promise that resolves with all converted tools.
   */
  public async createToolsFromConnectors(connectors: BaseConnector[]): Promise<T[]> {
    const tools: T[] = []
    for (const connector of connectors) {
      const connectorTools = await this.loadToolsForConnector(connector)
      tools.push(...connectorTools)
    }

    logger.debug(`Available tools: ${tools.length}`)
    return tools
  }

  /**
   * Check if a connector is initialized and has tools.
   *
   * @param connector The connector to check.
   * @returns         True if the connector is initialized and has tools, false otherwise.
   */
  private checkConnectorInitialized(connector: BaseConnector): boolean {
    return Boolean(connector.tools && connector.tools.length)
  }

  /**
   * Ensure a connector is initialized.
   *
   * @param connector The connector to initialize.
   * @returns         True if initialization succeeded, false otherwise.
   */
  private async ensureConnectorInitialized(connector: BaseConnector): Promise<boolean> {
    if (!this.checkConnectorInitialized(connector)) {
      logger.debug('Connector doesn\'t have tools, initializing it')
      try {
        await connector.initialize()
        return true
      }
      catch (err) {
        logger.error(`Error initializing connector: ${err}`)
        return false
      }
    }
    return true
  }
}
