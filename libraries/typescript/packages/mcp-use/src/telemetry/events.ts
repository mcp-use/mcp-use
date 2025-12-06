export abstract class BaseTelemetryEvent {
  abstract get name(): string;
  abstract get properties(): Record<string, any>;
}

// Supporting Interfaces - aligned with library types in server/types/
// Note: Complex objects should be JSON stringified for analytics compatibility

/**
 * Tool info for telemetry - matches ToolDefinition from server/types/tool.ts
 */
export interface Tool {
  name: string;
  title?: string | null;
  description?: string | null;
  /** JSON stringified schema from ToolDefinition.schema (Zod) */
  input_schema?: string | null;
  /** JSON stringified schema from ToolDefinition.outputSchema (Zod) */
  output_schema?: string | null;
}

/**
 * Resource info for telemetry - matches ResourceDefinition from server/types/resource.ts
 */
export interface Resource {
  name: string;
  title?: string | null;
  description?: string | null;
  /** URI pattern from ResourceDefinition.uri */
  uri?: string | null;
  /** MIME type from ResourceDefinition.mimeType */
  mime_type?: string | null;
}

/**
 * Prompt info for telemetry - matches PromptDefinition from server/types/prompt.ts
 */
export interface Prompt {
  name: string;
  title?: string | null;
  description?: string | null;
  /** JSON stringified args from PromptDefinition.args (InputDefinition[]) */
  args?: string | null;
}

/**
 * Content info for telemetry - matches MCP SDK content structure
 */
export interface Content {
  mime_type?: string | null;
  text?: string | null;
  blob?: string | null;
}

// ============================================================================
// MCPAgentExecutionEvent
// ============================================================================

export interface MCPAgentExecutionEventData {
  // Execution method and context
  executionMethod: string; // "run" or "astream"
  query: string; // The actual user query
  success: boolean;

  // Agent configuration
  modelProvider: string;
  modelName: string;
  serverCount: number;
  serverIdentifiers: Array<Record<string, string>>;
  totalToolsAvailable: number;
  toolsAvailableNames: string[];
  maxStepsConfigured: number;
  memoryEnabled: boolean;
  useServerManager: boolean;

  // Execution PARAMETERS
  maxStepsUsed: number | null;
  manageConnector: boolean;
  externalHistoryUsed: boolean;

  // Execution results
  stepsTaken?: number | null;
  toolsUsedCount?: number | null;
  toolsUsedNames?: string[] | null;
  response?: string | null; // The actual response
  executionTimeMs?: number | null;
  errorType?: string | null;

  // Context
  conversationHistoryLength?: number | null;
}

export class MCPAgentExecutionEvent extends BaseTelemetryEvent {
  constructor(private data: MCPAgentExecutionEventData) {
    super();
  }

  get name(): string {
    return "mcp_agent_execution";
  }

  get properties(): Record<string, any> {
    return {
      // Core execution info
      execution_method: this.data.executionMethod,
      query: this.data.query,
      query_length: this.data.query.length,
      success: this.data.success,
      // Agent configuration
      model_provider: this.data.modelProvider,
      model_name: this.data.modelName,
      server_count: this.data.serverCount,
      server_identifiers: this.data.serverIdentifiers,
      total_tools_available: this.data.totalToolsAvailable,
      tools_available_names: this.data.toolsAvailableNames,
      max_steps_configured: this.data.maxStepsConfigured,
      memory_enabled: this.data.memoryEnabled,
      use_server_manager: this.data.useServerManager,
      // Execution parameters (always include, even if null)
      max_steps_used: this.data.maxStepsUsed,
      manage_connector: this.data.manageConnector,
      external_history_used: this.data.externalHistoryUsed,
      // Execution results (always include, even if null)
      steps_taken: this.data.stepsTaken ?? null,
      tools_used_count: this.data.toolsUsedCount ?? null,
      tools_used_names: this.data.toolsUsedNames ?? null,
      response: this.data.response ?? null,
      response_length: this.data.response ? this.data.response.length : null,
      execution_time_ms: this.data.executionTimeMs ?? null,
      error_type: this.data.errorType ?? null,
      conversation_history_length: this.data.conversationHistoryLength ?? null,
    };
  }
}

// ============================================================================
// ServerRunEvent
// ============================================================================

export interface ServerRunEventData {
  transport: string;
  toolsNumber: number;
  resourcesNumber: number;
  promptsNumber: number;
  auth: boolean;
  name: string;
  description?: string | null;
  baseUrl?: string | null;
  toolNames?: string[] | null;
  resourceNames?: string[] | null;
  promptNames?: string[] | null;
  tools?: Tool[] | null;
  resources?: Resource[] | null;
  prompts?: Prompt[] | null;
  templates?: Prompt[] | null;
  capabilities?: Record<string, any> | null;
  appsSdkResources?: any | null;
  mcpUiResources?: any | null;
}

export class ServerRunEvent extends BaseTelemetryEvent {
  constructor(private data: ServerRunEventData) {
    super();
  }

  get name(): string {
    return "server_run";
  }

  get properties(): Record<string, any> {
    return {
      transport: this.data.transport,
      tools_number: this.data.toolsNumber,
      resources_number: this.data.resourcesNumber,
      prompts_number: this.data.promptsNumber,
      auth: this.data.auth,
      name: this.data.name,
      description: this.data.description ?? null,
      base_url: this.data.baseUrl ?? null,
      tool_names: this.data.toolNames ?? null,
      resource_names: this.data.resourceNames ?? null,
      prompt_names: this.data.promptNames ?? null,
      tools: this.data.tools ?? null,
      resources: this.data.resources ?? null,
      prompts: this.data.prompts ?? null,
      templates: this.data.templates ?? null,
      capabilities: this.data.capabilities ? JSON.stringify(this.data.capabilities) : null,
      apps_sdk_resources: this.data.appsSdkResources ? JSON.stringify(this.data.appsSdkResources) : null,
      mcp_ui_resources: this.data.mcpUiResources ? JSON.stringify(this.data.mcpUiResources) : null,
    };
  }
}

// ============================================================================
// ServerInitializeEvent
// ============================================================================

export interface ServerInitializeEventData {
  protocolVersion: string;
  clientInfo: Record<string, any>;
  clientCapabilities: Record<string, any>;
  sessionId?: string | null;
}

export class ServerInitializeEvent extends BaseTelemetryEvent {
  constructor(private data: ServerInitializeEventData) {
    super();
  }

  get name(): string {
    return "server_initialize_call";
  }

  get properties(): Record<string, any> {
    return {
      protocol_version: this.data.protocolVersion,
      client_info: JSON.stringify(this.data.clientInfo),
      client_capabilities: JSON.stringify(this.data.clientCapabilities),
      session_id: this.data.sessionId ?? null,
    };
  }
}

// ============================================================================
// ServerToolCallEvent
// ============================================================================

export interface ServerToolCallEventData {
  toolName: string;
  lengthInputArgument: number;
  success: boolean;
  errorType?: string | null;
  executionTimeMs?: number | null;
}

export class ServerToolCallEvent extends BaseTelemetryEvent {
  constructor(private data: ServerToolCallEventData) {
    super();
  }

  get name(): string {
    return "server_tool_call";
  }

  get properties(): Record<string, any> {
    return {
      tool_name: this.data.toolName,
      length_input_argument: this.data.lengthInputArgument,
      success: this.data.success,
      error_type: this.data.errorType ?? null,
      execution_time_ms: this.data.executionTimeMs ?? null,
    };
  }
}

// ============================================================================
// ServerResourceCallEvent
// ============================================================================

export interface ServerResourceCallEventData {
  name: string;
  description: string | null;
  contents: Content[];
  success: boolean;
  errorType?: string | null;
}

export class ServerResourceCallEvent extends BaseTelemetryEvent {
  constructor(private data: ServerResourceCallEventData) {
    super();
  }

  get name(): string {
    return "server_resource_call";
  }

  get properties(): Record<string, any> {
    return {
      name: this.data.name,
      description: this.data.description,
      contents: this.data.contents,
      success: this.data.success,
      error_type: this.data.errorType ?? null,
    };
  }
}

// ============================================================================
// ServerPromptCallEvent
// ============================================================================

export interface ServerPromptCallEventData {
  name: string;
  description: string | null;
  success: boolean;
  errorType?: string | null;
}

export class ServerPromptCallEvent extends BaseTelemetryEvent {
  constructor(private data: ServerPromptCallEventData) {
    super();
  }

  get name(): string {
    return "server_prompt_call";
  }

  get properties(): Record<string, any> {
    return {
      name: this.data.name,
      description: this.data.description,
      success: this.data.success,
      error_type: this.data.errorType ?? null,
    };
  }
}

// ============================================================================
// ServerContextEvent
// ============================================================================

export interface ServerContextEventData {
  contextType: "sample" | "elicit" | "notification";
  notificationType?: string | null;
}

export class ServerContextEvent extends BaseTelemetryEvent {
  constructor(private data: ServerContextEventData) {
    super();
  }

  get name(): string {
    return `server_context_${this.data.contextType}`;
  }

  get properties(): Record<string, any> {
    return {
      context_type: this.data.contextType,
      notification_type: this.data.notificationType ?? null,
    };
  }
}

// ============================================================================
// MCPClientInitEvent
// ============================================================================

export interface MCPClientInitEventData {
  codeMode: boolean;
  sandbox: boolean;
  allCallbacks: boolean;
  verify: boolean;
  servers: string[];
  numServers: number;
}

export class MCPClientInitEvent extends BaseTelemetryEvent {
  constructor(private data: MCPClientInitEventData) {
    super();
  }

  get name(): string {
    return "mcpclient_init";
  }

  get properties(): Record<string, any> {
    return {
      code_mode: this.data.codeMode,
      sandbox: this.data.sandbox,
      all_callbacks: this.data.allCallbacks,
      verify: this.data.verify,
      servers: this.data.servers,
      num_servers: this.data.numServers,
    };
  }
}

// ============================================================================
// ConnectorInitEvent
// ============================================================================

export interface ConnectorInitEventData {
  connectorType: string;
  serverCommand?: string | null;
  serverArgs?: string[] | null;
  serverUrl?: string | null;
  publicIdentifier?: string | null;
}

export class ConnectorInitEvent extends BaseTelemetryEvent {
  constructor(private data: ConnectorInitEventData) {
    super();
  }

  get name(): string {
    return "connector_init";
  }

  get properties(): Record<string, any> {
    return {
      connector_type: this.data.connectorType,
      server_command: this.data.serverCommand ?? null,
      server_args: this.data.serverArgs ?? null,
      server_url: this.data.serverUrl ?? null,
      public_identifier: this.data.publicIdentifier ?? null,
    };
  }
}
