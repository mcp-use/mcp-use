import type { IServerManager } from "../types.js";
import { z } from "zod";
import { logger } from "@mcp-use/client";
import { MCPServerTool } from "./base.js";

const EnumerateServersSchema = z.object({});

/** Lists configured MCP servers and their cached capability counts. */
export class ListMCPServersTool extends MCPServerTool<
  typeof EnumerateServersSchema
> {
  /** Tool name exposed to the model. */
  override name = "list_mcp_servers";
  /** Tool description exposed to the model. */
  override description = `Lists all available MCP (Model Context Protocol) servers that can be connected to, along with the tools available on each server. Use this tool to discover servers and see what functionalities they offer.`;
  /** Empty input schema. */
  override schema = EnumerateServersSchema;

  constructor(manager: IServerManager) {
    super(manager);
  }

  /** @returns A formatted list of configured servers and capability counts. */
  async _call(): Promise<string> {
    const serverNames = this.manager.client.getServerNames();
    if (serverNames.length === 0) {
      return `No MCP servers are currently defined.`;
    }

    const outputLines: string[] = ["Available MCP servers:"];

    for (const serverName of serverNames) {
      const isActiveServer = serverName === this.manager.activeServer;
      const activeFlag = isActiveServer ? " (ACTIVE)" : "";
      outputLines.push(`- ${serverName}${activeFlag}`);

      try {
        const serverTools = this.manager.serverTools?.[serverName] ?? [];
        const numberOfTools = Array.isArray(serverTools)
          ? serverTools.length
          : 0;
        outputLines.push(`${numberOfTools} tools available for this server\n`);
      } catch (error) {
        logger.error(
          `Unexpected error listing tools for server '${serverName}': ${String(error)}`
        );
      }
    }
    return outputLines.join("\n");
  }
}
