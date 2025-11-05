export abstract class BaseTelemetryEvent {
  abstract get name(): string;
  abstract get properties(): Record<string, any>;
}

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
