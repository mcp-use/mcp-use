/**
 * MCP Tool type
 */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

/**
 * MCP Resource type
 */
export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP Prompt type
 */
export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

/**
 * MCP Primitives collection
 */
export interface McpPrimitives {
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
}

/**
 * Chat message
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolCalls?: any[];
  thinking?: string;
  isThinking?: boolean;
}

/**
 * MCP Connection
 */
export interface McpConnection {
  projectName: string;
  url: string;
  connected: boolean;
  primitives?: McpPrimitives;
}
