import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps";

export abstract class BaseTelemetryEvent {
  abstract get name(): string;
  abstract get properties(): Record<string, any>;
}

// Supporting Interfaces - aligned with library types in server/types/
// Note: Complex objects should be JSON stringified for analytics compatibility

/**
 * Tool info for telemetry - matches ToolDefinition from server/types/tool.ts
 */
interface Tool {
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
interface Resource {
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
interface Prompt {
  name: string;
  title?: string | null;
  description?: string | null;
  /** JSON stringified args from PromptDefinition.args (InputDefinition[]) */
  args?: string | null;
}

/**
 * Content info for telemetry - matches MCP SDK content structure
 */
interface Content {
  mime_type?: string | null;
  text?: string | null;
  blob?: string | null;
}

// ============================================================================
// ServerRunEvent
// ============================================================================

interface ServerRunEventData {
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
  appsSdkResources?: Resource[] | null;
  appsSdkResourcesNumber?: number;
  mcpUiResources?: Resource[] | null;
  mcpUiResourcesNumber?: number;
  mcpAppsResources?: Resource[] | null;
  mcpAppsResourcesNumber?: number;
}

/**
 * Interface for MCPServer data needed for telemetry tracking.
 * This allows the telemetry layer to extract data from an MCPServer instance
 * without importing the full MCPServer class (avoiding circular dependencies).
 */
export interface MCPServerTelemetryInfo {
  registeredTools: string[];
  registeredPrompts: string[];
  registeredResources: string[];
  config: { name: string; description?: string };
  serverBaseUrl?: string;
  oauthProvider?: unknown;
  registrations: {
    tools: Map<
      string,
      {
        config: {
          name: string;
          title?: string;
          description?: string;
          schema?: unknown;
          outputSchema?: unknown;
        };
        handler: unknown;
      }
    >;
    prompts: Map<
      string,
      {
        config: {
          name: string;
          title?: string;
          description?: string;
          args?: unknown;
        };
        handler: unknown;
      }
    >;
    resources: Map<
      string,
      {
        config: {
          name: string;
          title?: string;
          description?: string;
          uri?: string;
          mimeType?: string;
        };
        handler: unknown;
      }
    >;
    resourceTemplates: Map<
      string,
      {
        config: { name: string; title?: string; description?: string };
        handler: unknown;
      }
    >;
  };
}

/**
 * Creates ServerRunEventData from an MCPServer-like object.
 * This centralizes the data extraction logic in the telemetry layer.
 */
export function createServerRunEventData(
  server: MCPServerTelemetryInfo,
  transport: string
): ServerRunEventData {
  const toolRegistrations = Array.from(server.registrations.tools.values());
  const promptRegistrations = Array.from(server.registrations.prompts.values());
  const resourceRegistrations = Array.from(
    server.registrations.resources.values()
  );
  const templateRegistrations = Array.from(
    server.registrations.resourceTemplates.values()
  );

  // Map all resources to the Resource format
  const allResources: Resource[] = resourceRegistrations.map((r) => ({
    name: r.config.name,
    title: r.config.title ?? null,
    description: r.config.description ?? null,
    uri: r.config.uri ?? null,
    mime_type: r.config.mimeType ?? null,
  }));

  // Filter resources by mime_type
  const appsSdkResources = allResources.filter(
    (r) => r.mime_type === "text/html+skybridge"
  );
  const mcpUiResources = allResources.filter(
    (r) => r.mime_type === "text/uri-list" || r.mime_type === "text/html"
  );
  const mcpAppsResources = allResources.filter(
    (r) => r.mime_type === RESOURCE_MIME_TYPE
  );

  return {
    transport,
    toolsNumber: server.registeredTools.length,
    resourcesNumber: server.registeredResources.length,
    promptsNumber: server.registeredPrompts.length,
    auth: !!server.oauthProvider,
    name: server.config.name,
    description: server.config.description ?? null,
    baseUrl: server.serverBaseUrl ?? null,
    toolNames:
      server.registeredTools.length > 0 ? server.registeredTools : null,
    resourceNames:
      server.registeredResources.length > 0 ? server.registeredResources : null,
    promptNames:
      server.registeredPrompts.length > 0 ? server.registeredPrompts : null,
    tools:
      toolRegistrations.length > 0
        ? toolRegistrations.map((r) => ({
            name: r.config.name,
            title: r.config.title ?? null,
            description: r.config.description ?? null,
            input_schema: r.config.schema
              ? JSON.stringify(r.config.schema)
              : null,
            output_schema: r.config.outputSchema
              ? JSON.stringify(r.config.outputSchema)
              : null,
          }))
        : null,
    resources: allResources.length > 0 ? allResources : null,
    prompts:
      promptRegistrations.length > 0
        ? promptRegistrations.map((r) => ({
            name: r.config.name,
            title: r.config.title ?? null,
            description: r.config.description ?? null,
            args: r.config.args ? JSON.stringify(r.config.args) : null,
          }))
        : null,
    templates:
      templateRegistrations.length > 0
        ? templateRegistrations.map((r) => ({
            name: r.config.name,
            title: r.config.title ?? null,
            description: r.config.description ?? null,
          }))
        : null,
    capabilities: {
      logging: true,
      resources: { subscribe: true, listChanged: true },
    },
    appsSdkResources: appsSdkResources.length > 0 ? appsSdkResources : null,
    appsSdkResourcesNumber: appsSdkResources.length,
    mcpUiResources: mcpUiResources.length > 0 ? mcpUiResources : null,
    mcpUiResourcesNumber: mcpUiResources.length,
    mcpAppsResources: mcpAppsResources.length > 0 ? mcpAppsResources : null,
    mcpAppsResourcesNumber: mcpAppsResources.length,
  };
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
      capabilities: this.data.capabilities
        ? JSON.stringify(this.data.capabilities)
        : null,
      apps_sdk_resources: this.data.appsSdkResources
        ? JSON.stringify(this.data.appsSdkResources)
        : null,
      apps_sdk_resources_number: this.data.appsSdkResourcesNumber ?? 0,
      mcp_ui_resources: this.data.mcpUiResources
        ? JSON.stringify(this.data.mcpUiResources)
        : null,
      mcp_ui_resources_number: this.data.mcpUiResourcesNumber ?? 0,
      mcp_apps_resources: this.data.mcpAppsResources
        ? JSON.stringify(this.data.mcpAppsResources)
        : null,
      mcp_apps_resources_number: this.data.mcpAppsResourcesNumber ?? 0,
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
