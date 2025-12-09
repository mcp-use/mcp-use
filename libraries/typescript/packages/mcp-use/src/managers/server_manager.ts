import type { StructuredToolInterface } from "@langchain/core/tools";
import type { LangChainAdapter } from "../adapters/langchain_adapter.js";
import type { MCPClient } from "../client.js";
import type { BaseConnector } from "../connectors/base.js";
import type { MCPSession } from "../session.js";
import type { IServerManager } from "./types.js";
import { logger } from "../logging.js";
import { AcquireActiveMCPServerTool } from "./tools/acquire_active_mcp_server.js";
import { AddMCPServerFromConfigTool } from "./tools/add_server_from_config.js";
import { ConnectMCPServerTool } from "./tools/connect_mcp_server.js";
import { ListMCPServersTool } from "./tools/list_mcp_servers.js";
import { ReleaseMCPServerConnectionTool } from "./tools/release_mcp_server_connection.js";

/**
 * Deep equality check for comparing objects and arrays
 * Handles nested structures, primitives, arrays, and objects
 */
function isEqual(a: any, b: any): boolean {
  // Handle identical references and primitives
  if (a === b) return true;

  // Handle null/undefined cases
  if (a == null || b == null) return false;

  // Handle different types
  if (typeof a !== typeof b) return false;

  // Handle Date objects
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => isEqual(item, b[index]));
  }

  // Handle objects
  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) => {
      return (
        Object.prototype.hasOwnProperty.call(b, key) && isEqual(a[key], b[key])
      );
    });
  }

  // For primitives that aren't strictly equal
  return false;
}

export class ServerManager implements IServerManager {
  public readonly initializedServers: Record<string, boolean> = {};
  public readonly serverTools: Record<string, StructuredToolInterface[]> = {};

  public readonly client: MCPClient;
  public readonly adapter: LangChainAdapter;
  public activeServer: string | null = null;
  private overrideManagementTools?: StructuredToolInterface[];

  constructor(
    client: MCPClient,
    adapter: LangChainAdapter,
    managementTools?: StructuredToolInterface[]
  ) {
    this.client = client;
    this.adapter = adapter;
    this.overrideManagementTools = managementTools;
  }

  public setManagementTools(tools: StructuredToolInterface[]): void {
    this.overrideManagementTools = tools;
    logger.info(
      `Overriding default management tools with a new set of ${tools.length} tools.`
    );
  }

  public logState(context: string): void {
    const allServerNames = this.client.getServerNames();
    const activeSessionNames = Object.keys(this.client.getAllActiveSessions());

    if (allServerNames.length === 0) {
      logger.info("Server Manager State: No servers configured.");
      return;
    }

    const tableData = allServerNames.map((name) => ({
      "Server Name": name,
      Connected: activeSessionNames.includes(name) ? "✅" : "❌",
      Initialized: this.initializedServers[name] ? "✅" : "❌",
      "Tool Count": this.serverTools[name]?.length ?? 0,
      Active: this.activeServer === name ? "✅" : "❌",
    }));

    logger.info(`Server Manager State: [${context}]`);
    console.table(tableData);
  }

  initialize(): void {
    const serverNames = this.client.getServerNames?.();
    if (serverNames.length === 0) {
      logger.warn("No MCP servers defined in client configuration");
    }
  }

  async prefetchServerTools(): Promise<void> {
    const servers: string[] = this.client.getServerNames();

    for (const serverName of servers) {
      try {
        let session: MCPSession | null = null;

        session = this.client.getSession(serverName);
        logger.debug(
          `Using existing session for server '${serverName}' to prefetch tools.`
        );

        if (!session) {
          session = await this.client
            .createSession(serverName)
            .catch((createSessionError) => {
              logger.warn(
                `Could not create session for '${serverName}' during prefetch: ${createSessionError}`
              );
              return null;
            });
          logger.debug(
            `Temporarily created session for '${serverName}' to prefetch tools.`
          );
        }

        if (session) {
          const connector: BaseConnector = session.connector;
          let tools: StructuredToolInterface[] = [];
          let resources: StructuredToolInterface[] = [];
          let prompts: StructuredToolInterface[] = [];

          try {
            tools = await this.adapter.createToolsFromConnectors([connector]);
            resources = await this.adapter.createResourcesFromConnectors([connector]);
            prompts = await this.adapter.createPromptsFromConnectors([connector]);
          } catch (toolFetchError) {
            logger.error(
              `Failed to create tools/resources/prompts from connector for server '${serverName}': ${toolFetchError}`
            );
            continue;
          }

          const allItems = [...tools, ...resources, ...prompts];
          const cachedTools = this.serverTools[serverName];
          const toolsChanged = !cachedTools || !isEqual(cachedTools, allItems);

          if (toolsChanged) {
            this.serverTools[serverName] = allItems;
            this.initializedServers[serverName] = true;
            logger.debug(
              `Prefetched ${allItems.length} items for server '${serverName}': ` +
                `${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts.`
            );
          } else {
            logger.debug(
              `Tools for server '${serverName}' unchanged, using cached version.`
            );
          }
        }
      } catch (outerError) {
        logger.error(
          `Error prefetching tools for server '${serverName}': ${outerError}`
        );
      }
    }
  }

  get tools(): StructuredToolInterface[] {
    if (logger.level === "debug") {
      this.logState("Providing tools to agent");
    }

    const managementTools = this.overrideManagementTools ?? [
      new AddMCPServerFromConfigTool(this),
      new ListMCPServersTool(this),
      new ConnectMCPServerTool(this),
      new AcquireActiveMCPServerTool(this),
      new ReleaseMCPServerConnectionTool(this),
    ];

    if (this.activeServer && this.serverTools[this.activeServer]) {
      const activeTools = this.serverTools[this.activeServer];
      logger.debug(
        `Adding ${activeTools.length} tools from active server '${this.activeServer}'`
      );
      return [...managementTools, ...activeTools];
    }

    return managementTools;
  }
}
