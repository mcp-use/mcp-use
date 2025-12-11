import type { ToolContext, ToolResult } from "../types.js";
import { createToolDefinition, type AnthropicTool } from "../tool-types.js";

export interface ListPrimitivesParams {
  projectName: string;
}

/**
 * List tools, resources, and prompts from a connected MCP server
 */
export async function listPrimitivesTool(
  params: ListPrimitivesParams,
  context: ToolContext
): Promise<ToolResult> {
  const { projectName } = params;

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

    // Get tools, resources, and prompts
    const tools = await session.listTools();
    const resources = await session.listResources();
    const prompts = await session.listPrompts();

    const toolsList = Array.isArray(tools) ? tools : [];
    const resourcesList = Array.isArray(resources) ? resources : [];
    const promptsList = Array.isArray(prompts) ? prompts : [];

    return {
      success: true,
      data: {
        projectName,
        tools: toolsList.map((t: any) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
        resources: resourcesList.map((r: any) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        })),
        prompts: promptsList.map((p: any) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments,
        })),
      },
      message: `Found ${toolsList.length} tools, ${resourcesList.length} resources, and ${promptsList.length} prompts`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to list primitives: ${error.message}`,
    };
  }
}

/**
 * Tool definition for Claude Agent SDK
 */
export const listPrimitivesToolDefinition: AnthropicTool = createToolDefinition(
  {
    name: "list_primitives",
    description:
      "List all tools, resources, and prompts available from a connected MCP server. Use this to see what the server exposes.",
    properties: {
      projectName: {
        type: "string",
        description:
          "Name of the MCP server project (must be connected via connect_mcp first)",
      },
    },
    required: ["projectName"],
  }
);
