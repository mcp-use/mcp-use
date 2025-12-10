/**
 * TestToolTool - Test tools on a running MCP server
 */

import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { MCPClient } from "mcp-use";

/**
 * TestToolTool - Connect to an MCP server and test a tool
 */
export class TestToolTool extends StructuredTool {
  name = "test_mcp_tool";
  description = `Test a tool on a running MCP server by connecting to it and calling the tool.
  The server must be running (use start_server first).
  Provide the server URL, tool name, and input arguments.
  This helps verify that your server is working correctly and tools are functioning as expected.`;

  schema = z.object({
    serverUrl: z
      .string()
      .describe(
        'URL of the running MCP server (e.g., "http://localhost:3100/mcp")'
      ),
    toolName: z.string().describe("Name of the tool to test"),
    toolInput: z
      .record(z.any())
      .describe("Input arguments for the tool as a JSON object")
      .default({}),
  });

  protected async _call({
    serverUrl,
    toolName,
    toolInput,
  }: z.infer<typeof this.schema>): Promise<string> {
    let client: MCPClient | null = null;

    try {
      // Create MCP client and connect to server
      client = new MCPClient({
        servers: {
          "test-server": {
            url: serverUrl,
          },
        },
      });

      // Create session
      const session = await client.createSession("test-server");

      // List available tools
      const tools = await session.connector.listTools();
      const tool = tools.tools?.find((t) => t.name === toolName);

      if (!tool) {
        const availableTools =
          tools.tools?.map((t) => t.name).join(", ") || "none";
        throw new Error(
          `Tool "${toolName}" not found. Available tools: ${availableTools}`
        );
      }

      // Call the tool
      const result = await session.connector.callTool(toolName, toolInput);

      let response = `✅ Successfully tested tool "${toolName}"\n\n`;
      response += `📥 Input:\n${JSON.stringify(toolInput, null, 2)}\n\n`;
      response += `📤 Output:\n`;

      if (result.content && Array.isArray(result.content)) {
        for (const content of result.content) {
          if (content.type === "text") {
            response += content.text + "\n";
          } else if (content.type === "image") {
            response += `[Image: ${content.data?.substring(0, 50)}...]\n`;
          } else if (content.type === "resource") {
            response += `[Resource: ${JSON.stringify(content)}]\n`;
          }
        }
      } else {
        response += JSON.stringify(result, null, 2);
      }

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to test tool: ${message}`);
    } finally {
      // Clean up client connection
      if (client) {
        try {
          await client.close();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}

/**
 * ListServerToolsTool - List available tools on a running MCP server
 */
export class ListServerToolsTool extends StructuredTool {
  name = "list_server_tools";
  description = `List all available tools, resources, and prompts on a running MCP server.
  The server must be running (use start_server first).
  This helps you discover what capabilities the server exposes.`;

  schema = z.object({
    serverUrl: z
      .string()
      .describe(
        'URL of the running MCP server (e.g., "http://localhost:3100/mcp")'
      ),
  });

  protected async _call({
    serverUrl,
  }: z.infer<typeof this.schema>): Promise<string> {
    let client: MCPClient | null = null;

    try {
      // Create MCP client and connect to server
      client = new MCPClient({
        servers: {
          "test-server": {
            url: serverUrl,
          },
        },
      });

      // Create session
      const session = await client.createSession("test-server");

      // List capabilities
      const tools = await session.connector.listTools();
      const resources = await session.connector.listResources();
      const prompts = await session.connector.listPrompts();

      let response = `✅ Successfully connected to server\n\n`;
      response += `📊 Server Capabilities:\n\n`;

      // Tools
      response += `🔧 Tools (${tools.tools?.length || 0}):\n`;
      if (tools.tools && tools.tools.length > 0) {
        for (const tool of tools.tools) {
          response += `  - ${tool.name}`;
          if (tool.description) {
            response += `: ${tool.description.substring(0, 100)}${tool.description.length > 100 ? "..." : ""}`;
          }
          response += "\n";
        }
      } else {
        response += "  (none)\n";
      }

      response += "\n";

      // Resources
      response += `📦 Resources (${resources.resources?.length || 0}):\n`;
      if (resources.resources && resources.resources.length > 0) {
        for (const resource of resources.resources) {
          response += `  - ${resource.uri}`;
          if (resource.name) {
            response += ` (${resource.name})`;
          }
          response += "\n";
        }
      } else {
        response += "  (none)\n";
      }

      response += "\n";

      // Prompts
      response += `💬 Prompts (${prompts.prompts?.length || 0}):\n`;
      if (prompts.prompts && prompts.prompts.length > 0) {
        for (const prompt of prompts.prompts) {
          response += `  - ${prompt.name}`;
          if (prompt.description) {
            response += `: ${prompt.description.substring(0, 100)}${prompt.description.length > 100 ? "..." : ""}`;
          }
          response += "\n";
        }
      } else {
        response += "  (none)\n";
      }

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list server capabilities: ${message}`);
    } finally {
      // Clean up client connection
      if (client) {
        try {
          await client.close();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}
