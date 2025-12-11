import type { ToolContext, ToolResult } from "../types.js";
import { createToolDefinition, type AnthropicTool } from "../tool-types.js";

export interface CallToolParams {
  projectName: string;
  toolName: string;
  toolInput: Record<string, any>;
}

/**
 * Call a tool on a connected MCP server
 */
export async function callToolTool(
  params: CallToolParams,
  context: ToolContext
): Promise<ToolResult> {
  const { projectName, toolName, toolInput } = params;

  try {
    const client = context.mcpConnections.get(projectName);

    if (!client) {
      return {
        success: false,
        error: `Not connected to MCP server '${projectName}'. Use connect_mcp first.`,
      };
    }

    // Get or create session
    const session = await client.createSession(
      client.getServerNames()[0],
      true
    );

    // Call the tool
    const result = await session.callTool(toolName, toolInput);

    return {
      success: true,
      data: {
        projectName,
        toolName,
        toolInput,
        toolResult: result,
      },
      message: `Successfully called tool '${toolName}'`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to call tool '${toolName}': ${error.message}`,
      data: {
        projectName,
        toolName,
        toolInput,
      },
    };
  }
}

/**
 * Tool definition for Claude Agent SDK
 */
export const callToolToolDefinition: AnthropicTool = createToolDefinition({
  name: "call_tool",
  description:
    "Execute a tool on a connected MCP server and get the result. Use this to test if tools work correctly.",
  properties: {
    projectName: {
      type: "string",
      description:
        "Name of the MCP server project (must be connected via connect_mcp first)",
    },
    toolName: {
      type: "string",
      description: "Name of the tool to call",
    },
    toolInput: {
      type: "object",
      description: "Input parameters for the tool as a JSON object",
      additionalProperties: true,
    },
  },
  required: ["projectName", "toolName", "toolInput"],
});
