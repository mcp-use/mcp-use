/**
 * Tool execution context shared across tools
 */
export interface ToolContext {
  workspaceDir: string;
  mcpConnections: Map<string, any>; // Map of projectName -> MCPClient
}

/**
 * Tool result type
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}
