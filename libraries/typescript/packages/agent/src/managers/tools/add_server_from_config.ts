import type { StructuredToolInterface } from "@langchain/core/tools";
import type { IServerManager } from "../types.js";
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "@mcp-use/client";

/** Adds, connects, and activates an MCP server from model-supplied config. */
export class AddMCPServerFromConfigTool extends StructuredTool {
  /** Tool name exposed to the model. */
  name = "add_mcp_server_from_config";
  /** Tool description exposed to the model. */
  description =
    "Adds a new MCP server to the client from a configuration object and connects to it, making its tools available.";

  /** Input schema for the server name and transport configuration. */
  schema = z.object({
    /** Name used to register the server with the MCP client. */
    serverName: z.string().describe("The name for the new MCP server."),
    /** MCP transport configuration without a top-level `mcpServers` key. */
    serverConfig: z
      .any()
      .describe(
        'The configuration object for the server. This should not include the top-level "mcpServers" key.'
      ),
  });

  private manager: IServerManager;

  /**
   * @param manager - Server manager that receives the new server.
   */
  constructor(manager: IServerManager) {
    super();
    this.manager = manager;
  }

  /**
   * Adds the server, opens a session, and makes the server active.
   *
   * @returns A success message with loaded tool names, or an error message.
   */
  protected async _call({
    serverName,
    serverConfig,
  }: z.infer<typeof this.schema>): Promise<string> {
    try {
      this.manager.client.addServer(serverName, serverConfig);
      let result = `Server '${serverName}' added to the client.`;
      logger.debug(
        `Connecting to new server '${serverName}' and discovering tools.`
      );
      const session = await this.manager.client.createSession(serverName);
      const connector = session.connector;
      const tools: StructuredToolInterface[] =
        await this.manager.adapter.createToolsFromConnectors([connector]);

      this.manager.serverTools[serverName] = tools;
      this.manager.initializedServers[serverName] = true;
      this.manager.activeServer = serverName; // Set as active server

      const numTools = tools.length;
      result += ` Session created and connected. '${serverName}' is now the active server with ${numTools} tools available.`;
      result += `\n\n${tools.map((t) => t.name).join("\n")}`;
      logger.debug(result);
      return result;
    } catch (e: any) {
      logger.error(
        `Failed to add or connect to server '${serverName}': ${e.message}`
      );
      return `Failed to add or connect to server '${serverName}': ${e.message}`;
    }
  }
}
