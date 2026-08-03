import type { IServerManager } from "../types.js";
import { z } from "zod";
import { MCPServerTool } from "./base.js";

const ReleaseConnectionSchema = z.object({});

/** Deactivates the current MCP server without closing its client session. */
export class ReleaseMCPServerConnectionTool extends MCPServerTool<
  typeof ReleaseConnectionSchema
> {
  /** Tool name exposed to the model. */
  override name = "disconnect_from_mcp_server";
  /** Tool description exposed to the model. */
  override description =
    "Disconnect from the currently active MCP (Model Context Protocol) server";
  /** Empty input schema. */
  override schema = ReleaseConnectionSchema;

  constructor(manager: IServerManager) {
    super(manager);
  }

  /** @returns A message identifying the deactivated server, or stating there is none. */
  async _call(): Promise<string> {
    if (!this.manager.activeServer) {
      return `No MCP server is currently active, so there's nothing to disconnect from.`;
    }
    const serverName = this.manager.activeServer;
    this.manager.activeServer = null;
    return `Successfully disconnected from MCP server '${serverName}'.`;
  }
}
