import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseConnector } from "@mcp-use/client";
import type { IServerManager } from "../types.js";
import type { SchemaOutputT } from "./base.js";
import { z } from "zod";
import { logger } from "@mcp-use/client";
import { MCPServerTool } from "./base.js";

const ConnectMCPServerSchema = z.object({
  /** Name of a configured MCP server. */
  serverName: z.string().describe("The name of the MCP server."),
});

/** Activates a configured MCP server and exposes its capabilities. */
export class ConnectMCPServerTool extends MCPServerTool<
  typeof ConnectMCPServerSchema
> {
  /** Tool name exposed to the model. */
  override name = "connect_to_mcp_server";
  /** Tool description exposed to the model. */
  override description =
    "Connect to a specific MCP (Model Context Protocol) server to use its tools. Use this tool to connect to a specific server and use its tools.";
  /** Input schema containing the server name. */
  override schema = ConnectMCPServerSchema;

  constructor(manager: IServerManager) {
    super(manager);
  }

  /**
   * Activates a configured server and loads its capabilities if needed.
   *
   * @returns A human-readable success or error message.
   */
  async _call({ serverName }: SchemaOutputT<typeof ConnectMCPServerSchema>) {
    const serverNames = this.manager.client.getServerNames();

    if (!serverNames.includes(serverName)) {
      const available =
        serverNames.length > 0 ? serverNames.join(", ") : "none";
      return `Server '${serverName}' not found. Available servers: ${available}`;
    }

    if (this.manager.activeServer === serverName) {
      return `Already connected to MCP server '${serverName}'`;
    }

    try {
      let session = this.manager.client.getSession(serverName);
      logger.debug(`Using existing session for server '${serverName}'`);
      if (!session) {
        logger.debug(`Creating new session for server '${serverName}'`);
        session = await this.manager.client.createSession(serverName);
      }
      this.manager.activeServer = serverName;
      if (!this.manager.serverTools[serverName]) {
        const connector: BaseConnector = session.connector;
        const tools: StructuredToolInterface[] =
          await this.manager.adapter.createToolsFromConnectors([connector]);
        const resources: StructuredToolInterface[] =
          await this.manager.adapter.createResourcesFromConnectors([connector]);
        const prompts: StructuredToolInterface[] =
          await this.manager.adapter.createPromptsFromConnectors([connector]);
        const allItems = [...tools, ...resources, ...prompts];
        this.manager.serverTools[serverName] = allItems;
        this.manager.initializedServers[serverName] = true;
        logger.debug(
          `Loaded ${allItems.length} items for server '${serverName}': ` +
            `${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts`
        );
      }
      const serverTools: StructuredToolInterface[] =
        this.manager.serverTools[serverName] || [];
      const numTools: number = serverTools.length;
      return `Connected to MCP server '${serverName}'. ${numTools} tools, resources, and prompts are now available.`;
    } catch (error) {
      logger.error(
        `Error connecting to server '${serverName}': ${String(error)}`
      );
      return `Failed to connect to server '${serverName}': ${String(error)}`;
    }
  }
}
