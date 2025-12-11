import { MCPClient } from "mcp-use";
import type { ToolContext, ToolResult } from "../types.js";
import { createToolDefinition, type AnthropicTool } from "../tool-types.js";

export interface ConnectMcpParams {
  projectName: string;
  url: string;
}

/**
 * Connect to an MCP server
 */
export async function connectMcpTool(
  params: ConnectMcpParams,
  context: ToolContext
): Promise<ToolResult> {
  const { projectName, url } = params;

  try {
    // Check if already connected
    if (context.mcpConnections.has(projectName)) {
      return {
        success: true,
        message: `Already connected to MCP server '${projectName}'`,
        data: {
          projectName,
          url,
          alreadyConnected: true,
        },
      };
    }

    // Create MCP client
    const client = new MCPClient({
      mcpServers: {
        [projectName]: {
          url,
        },
      },
    });

    // Wait a bit for connection to establish
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Store connection
    context.mcpConnections.set(projectName, client);

    return {
      success: true,
      data: {
        projectName,
        url,
        connected: true,
      },
      message: `Successfully connected to MCP server '${projectName}' at ${url}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to connect to MCP server: ${error.message}`,
    };
  }
}

/**
 * Tool definition for Claude Agent SDK
 */
export const connectMcpToolDefinition: AnthropicTool = createToolDefinition({
  name: "connect_mcp",
  description:
    "Connect to a running MCP server via HTTP. This establishes a connection that can be used to list and test tools.",
  properties: {
    projectName: {
      type: "string",
      description: "Name of the MCP server project to connect to",
    },
    url: {
      type: "string",
      description: "URL of the MCP server (e.g., 'http://localhost:3000')",
    },
  },
  required: ["projectName", "url"],
});
