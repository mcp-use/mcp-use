import { getWorkspaceDir } from "../server/workspace.js";
import { MANGO_SYSTEM_PROMPT } from "./prompts.js";
import {
  callToolTool,
  callToolToolDefinition,
  connectMcpTool,
  connectMcpToolDefinition,
  createServerTool,
  createServerToolDefinition,
  installDepsTool,
  installDepsToolDefinition,
  listFilesTool,
  listFilesToolDefinition,
  listPrimitivesTool,
  listPrimitivesToolDefinition,
  readFileTool,
  readFileToolDefinition,
  startServerTool,
  startServerToolDefinition,
  stopServerTool,
  stopServerToolDefinition,
  writeFileTool,
  writeFileToolDefinition,
} from "./tools/index.js";
import type { ToolContext } from "./types.js";

export interface MangoAgentOptions {
  workspaceDir?: string;
  apiKey?: string;
  model?: string;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Mango Agent - MCP Server Development Agent using Claude Agent SDK patterns
 *
 * Note: This is a simplified implementation that executes tools directly.
 * For production use with Claude Agent SDK, you would integrate with the actual SDK.
 */
export class MangoAgent {
  private context: ToolContext;
  private apiKey: string;
  private model: string;

  constructor(options: MangoAgentOptions = {}) {
    this.context = {
      workspaceDir: getWorkspaceDir(options.workspaceDir),
      mcpConnections: new Map(),
    };
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.model = options.model || "claude-sonnet-4-20250514";
  }

  /**
   * Get available tools for Claude
   */
  getTools() {
    return [
      createServerToolDefinition,
      readFileToolDefinition,
      writeFileToolDefinition,
      listFilesToolDefinition,
      installDepsToolDefinition,
      startServerToolDefinition,
      stopServerToolDefinition,
      connectMcpToolDefinition,
      listPrimitivesToolDefinition,
      callToolToolDefinition,
    ];
  }

  /**
   * Execute a tool call
   */
  async executeTool(toolName: string, toolInput: any): Promise<any> {
    switch (toolName) {
      case "create_server":
        return await createServerTool(toolInput, this.context);
      case "read_file":
        return await readFileTool(toolInput, this.context);
      case "write_file":
        return await writeFileTool(toolInput, this.context);
      case "list_files":
        return await listFilesTool(toolInput, this.context);
      case "install_deps":
        return await installDepsTool(toolInput, this.context);
      case "start_server":
        return await startServerTool(toolInput, this.context);
      case "stop_server":
        return await stopServerTool(toolInput, this.context);
      case "connect_mcp":
        return await connectMcpTool(toolInput, this.context);
      case "list_primitives":
        return await listPrimitivesTool(toolInput, this.context);
      case "call_tool":
        return await callToolTool(toolInput, this.context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Get the system prompt
   */
  getSystemPrompt(): string {
    return MANGO_SYSTEM_PROMPT;
  }

  /**
   * Get API configuration for Claude
   */
  getApiConfig() {
    return {
      apiKey: this.apiKey,
      model: this.model,
    };
  }

  /**
   * Get workspace directory
   */
  getWorkspaceDir(): string {
    return this.context.workspaceDir;
  }

  /**
   * Get MCP connections
   */
  getMcpConnections(): Map<string, any> {
    return this.context.mcpConnections;
  }

  /**
   * Disconnect from all MCP servers
   */
  async disconnect(): Promise<void> {
    // Clean up connections
    this.context.mcpConnections.clear();
  }
}

/**
 * Create a new Mango agent instance
 */
export function createMangoAgent(options: MangoAgentOptions = {}): MangoAgent {
  return new MangoAgent(options);
}
