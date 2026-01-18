declare module "mcp-use" {
  export interface MCPClientOptions {
    mcpServers: Record<string, unknown>;
  }

  export interface AgentStep {
    action?: {
      tool?: string;
      toolInput?: Record<string, unknown>;
      log?: string;
    };
    observation?: string;
  }

  export interface BaseMessage {
    content?: unknown;
    type?: string;
    _getType?: () => string;
    [key: string]: unknown;
  }

  export interface ToolSchema {
    name: string;
    description?: string;
    inputSchema: unknown;
  }

  export interface ResourceSchema {
    name: string;
    uri: string;
    description?: string;
    mimeType?: string;
  }

  export class MCPSession {
    tools: ToolSchema[];
    listResources(): Promise<{ resources?: ResourceSchema[] }>;
    readResource(uri: string, options?: unknown): Promise<unknown>;
  }

  export class MCPClient {
    constructor(options: MCPClientOptions);
    createAllSessions(): Promise<void>;
    closeAllSessions(): Promise<void>;
    getAllActiveSessions(): Record<string, MCPSession>;
    requireSession(name: string): MCPSession;
  }

  export interface MCPAgentOptions {
    client: MCPClient;
    llm: unknown;
    memoryEnabled?: boolean;
    callbacks?: unknown[];
    maxSteps?: number;
    autoInitialize?: boolean;
    systemPrompt?: string | null;
    systemPromptTemplate?: string | null;
    additionalInstructions?: string;
  }

  export class MCPAgent {
    constructor(options: MCPAgentOptions);
    stream(options: {
      prompt: string;
      signal?: AbortSignal;
    }): AsyncGenerator<AgentStep, void, void>;
    getConversationHistory(): BaseMessage[];
    close(): Promise<void>;
  }
}
