import { processManager } from "../../server/process-manager.js";
import type { ToolContext, ToolResult } from "../types.js";
import { createToolDefinition, type AnthropicTool } from "../tool-types.js";

export interface StopServerParams {
  projectName: string;
}

/**
 * Stop a running MCP server
 */
export async function stopServerTool(
  params: StopServerParams,
  context: ToolContext
): Promise<ToolResult> {
  const { projectName } = params;

  try {
    const wasRunning = processManager.isServerRunning(projectName);

    if (!wasRunning) {
      return {
        success: true,
        message: `Server '${projectName}' was not running`,
      };
    }

    await processManager.stopServer(projectName);

    return {
      success: true,
      message: `Successfully stopped MCP server '${projectName}'`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to stop server: ${error.message}`,
    };
  }
}

/**
 * Tool definition for Claude Agent SDK
 */
export const stopServerToolDefinition: AnthropicTool = createToolDefinition({
  name: "stop_server",
  description: "Stop a running MCP server process.",
  properties: {
    projectName: {
      type: "string",
      description: "Name of the MCP server project to stop",
    },
  },
  required: ["projectName"],
});
