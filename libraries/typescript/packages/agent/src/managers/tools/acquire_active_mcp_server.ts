import type { IServerManager } from "../types.js";
import { z } from "zod";
import { MCPServerTool } from "./base.js";

const PresentActiveServerSchema = z.object({});

/** Reports the MCP server whose tools are currently active. */
export class AcquireActiveMCPServerTool extends MCPServerTool<
  typeof PresentActiveServerSchema
> {
  /** Tool name exposed to the model. */
  override name = "get_active_mcp_server";
  /** Tool description exposed to the model. */
  override description =
    "Get the currently active MCP (Model Context Protocol) server";
  /** Empty input schema. */
  override schema = PresentActiveServerSchema;

  constructor(manager: IServerManager) {
    super(manager);
  }

  /** @returns A message identifying the active server, or stating there is none. */
  async _call(): Promise<string> {
    if (!this.manager.activeServer) {
      return `No MCP server is currently active. Use connect_to_mcp_server to connect to a server.`;
    }

    return `Currently active MCP server: ${this.manager.activeServer}`;
  }
}
