import { getProjectPath, isWithinWorkspace } from "../../server/workspace.js";
import { processManager } from "../../server/process-manager.js";
import type { ToolContext, ToolResult } from "../types.js";
import { createToolDefinition, type AnthropicTool } from "../tool-types.js";

export interface StartServerParams {
  projectName: string;
  port?: number;
}

/**
 * Start an MCP server
 */
export async function startServerTool(
  params: StartServerParams,
  context: ToolContext,
  onProgress?: (message: string) => void
): Promise<ToolResult> {
  const { projectName, port } = params;
  const projectPath = getProjectPath(projectName, context.workspaceDir);

  // Security check
  if (!isWithinWorkspace(projectPath, context.workspaceDir)) {
    return {
      success: false,
      error: "Project path is outside workspace directory",
    };
  }

  try {
    onProgress?.(
      `🚀 Starting MCP server '${projectName}'${port ? ` on port ${port}` : ""}...`
    );

    const serverProcess = await processManager.startServer(
      projectPath,
      projectName,
      port
    );

    onProgress?.(`⏳ Waiting for server to initialize...`);
    onProgress?.(`✅ Server started at ${serverProcess.url}`);

    return {
      success: true,
      data: {
        projectName,
        port: serverProcess.port,
        url: serverProcess.url,
        startedAt: serverProcess.startedAt,
      },
      message: `Successfully started MCP server '${projectName}' on ${serverProcess.url}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to start server: ${error.message}`,
    };
  }
}

/**
 * Tool definition for Claude Agent SDK
 */
export const startServerToolDefinition: AnthropicTool = createToolDefinition({
  name: "start_server",
  description:
    "Start an MCP server process on a specified port. The server will run in the background.",
  properties: {
    projectName: {
      type: "string",
      description: "Name of the MCP server project to start",
    },
    port: {
      type: "number",
      description: "Port to run the server on (default: 3000)",
      default: 3000,
    },
  },
  required: ["projectName"],
});
