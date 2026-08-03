export abstract class BaseTelemetryEvent {
  abstract get name(): string;
  abstract get properties(): Record<string, any>;
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
      query_length: this.data.query.length,
      success: this.data.success,
      // Agent configuration
      model_provider: this.data.modelProvider,
      model_name: this.data.modelName,
      server_count: this.data.serverCount,
      total_tools_available: this.data.totalToolsAvailable,
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
      response_length: this.data.response ? this.data.response.length : null,
      execution_time_ms: this.data.executionTimeMs ?? null,
      error_type: this.data.errorType ?? null,
      conversation_history_length: this.data.conversationHistoryLength ?? null,
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
  isBrowser: boolean; // true for BrowserMCPClient, false for Node.js MCPClient
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
      is_browser: this.data.isBrowser,
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

// ============================================================================
// ClientAddServerEvent
// ============================================================================

/**
 * Raw input data for tracking server addition.
 * The event class will extract the necessary properties.
 */
interface ClientAddServerEventInput {
  serverName: string;
  serverConfig: Record<string, any>;
}

export class ClientAddServerEvent extends BaseTelemetryEvent {
  constructor(private data: ClientAddServerEventInput) {
    super();
  }

  get name(): string {
    return "client_add_server";
  }

  get properties(): Record<string, any> {
    const { serverName, serverConfig } = this.data;
    const url = serverConfig.url;

    return {
      server_name: serverName,
      server_url_domain: url ? this._extractHostname(url) : null,
      transport: serverConfig.transport ?? null,
      has_auth: !!(serverConfig.authToken || serverConfig.authProvider),
    };
  }

  private _extractHostname(url: string): string | null {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// ClientRemoveServerEvent
// ============================================================================

/**
 * Raw input data for tracking server removal.
 */
interface ClientRemoveServerEventInput {
  serverName: string;
}

export class ClientRemoveServerEvent extends BaseTelemetryEvent {
  constructor(private data: ClientRemoveServerEventInput) {
    super();
  }

  get name(): string {
    return "client_remove_server";
  }

  get properties(): Record<string, any> {
    return {
      server_name: this.data.serverName,
    };
  }
}
