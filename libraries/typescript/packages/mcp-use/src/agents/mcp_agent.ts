import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { StreamEvent } from "@langchain/core/tracers/log_stream";
import {
  AIMessage,
  createAgent,
  HumanMessage,
  modelCallLimitMiddleware,
  SystemMessage,
  ToolMessage,
  type DynamicTool,
  type ReactAgent,
} from "langchain";
import type { ZodSchema } from "zod";
import { toJSONSchema } from "zod";
import { LangChainAdapter } from "../adapters/langchain_adapter.js";
import type { MCPClient } from "../client.js";
import type { BaseConnector } from "../connectors/base.js";
import { logger } from "../logging.js";
import { ServerManager } from "../managers/server_manager.js";
import { ObservabilityManager } from "../observability/index.js";
import type { MCPSession } from "../session.js";
import { extractModelInfo, Telemetry } from "../telemetry/index.js";
import { getPackageVersion } from "../version.js";
import { createSystemMessage } from "./prompts/system_prompt_builder.js";
import {
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  SERVER_MANAGER_SYSTEM_PROMPT_TEMPLATE,
} from "./prompts/templates.js";
import { RemoteAgent } from "./remote.js";
import type {
  BaseMessage,
  LanguageModel,
  MCPAgentOptions,
  MCPServerConfig,
} from "./types.js";
import { createLLMFromString, type LLMConfig } from "./utils/llm_provider.js";

/**
 * Represents a single step in the agent's execution
 */
export interface AgentStep {
  action: {
    tool: string;
    toolInput: any;
    log: string;
  };
  observation: string;
}

/**
 * Options for agent run, stream, and streamEvents methods
 */
export interface RunOptions<T = string> {
  prompt: string;
  maxSteps?: number;
  manageConnector?: boolean;
  externalHistory?: BaseMessage[];
  schema?: ZodSchema<T>;
}

/**
 * Helper function to normalize run options from either old-style positional arguments
 * or new-style options object
 */
function normalizeRunOptions<T>(
  queryOrOptions: string | RunOptions<T>,
  maxSteps?: number,
  manageConnector?: boolean,
  externalHistory?: BaseMessage[],
  outputSchema?: ZodSchema<T>
): {
  query: string;
  maxSteps?: number;
  manageConnector?: boolean;
  externalHistory?: BaseMessage[];
  outputSchema?: ZodSchema<T>;
} {
  // Check if first argument is an options object
  if (typeof queryOrOptions === "object" && queryOrOptions !== null) {
    const options = queryOrOptions as RunOptions<T>;
    return {
      query: options.prompt,
      maxSteps: options.maxSteps,
      manageConnector: options.manageConnector,
      externalHistory: options.externalHistory,
      outputSchema: options.schema,
    };
  }

  // Old-style positional arguments
  return {
    query: queryOrOptions as string,
    maxSteps,
    manageConnector,
    externalHistory,
    outputSchema,
  };
}

export class MCPAgent {
  /**
   * Get the mcp-use package version.
   * Works in all environments (Node.js, browser, Cloudflare Workers, Deno, etc.)
   */
  public static getPackageVersion(): string {
    return getPackageVersion();
  }

  private llm?: LanguageModel;
  private client?: MCPClient;
  private connectors: BaseConnector[];
  private maxSteps: number;
  private autoInitialize: boolean;
  private memoryEnabled: boolean;
  private disallowedTools: string[];
  private additionalTools: StructuredToolInterface[];
  public toolsUsedNames: string[] = [];
  private useServerManager: boolean;
  private verbose: boolean;
  private observe: boolean;
  private systemPrompt?: string | null;
  private systemPromptTemplateOverride?: string | null;
  private additionalInstructions?: string | null;

  private _initialized = false;
  private conversationHistory: BaseMessage[] = [];
  private _agentExecutor: ReactAgent | null = null;
  private sessions: Record<string, MCPSession> = {};
  private systemMessage: SystemMessage | null = null;
  private _tools: StructuredToolInterface[] = [];
  private adapter: LangChainAdapter;
  private serverManager: ServerManager | null = null;
  private telemetry: Telemetry;
  private modelProvider: string;
  private modelName: string;

  // Observability support
  public observabilityManager: ObservabilityManager;
  private callbacks: BaseCallbackHandler[] = [];
  private metadata: Record<string, any> = {};
  private tags: string[] = [];

  // Remote agent support
  private isRemote = false;
  private remoteAgent: RemoteAgent | null = null;

  // Simplified mode support
  private isSimplifiedMode = false;
  private llmString?: string;
  private llmConfig?: LLMConfig;
  private mcpServersConfig?: Record<string, MCPServerConfig>;
  private clientOwnedByAgent = false;

  constructor(options: MCPAgentOptions) {
    // Handle remote execution
    if (options.agentId) {
      this.isRemote = true;
      this.remoteAgent = new RemoteAgent({
        agentId: options.agentId,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
      });
      // Set default values for remote agent
      this.maxSteps = options.maxSteps ?? 5;
      this.memoryEnabled = options.memoryEnabled ?? true;
      this.autoInitialize = options.autoInitialize ?? false;
      this.verbose = options.verbose ?? false;
      this.observe = options.observe ?? true;
      this.connectors = [];
      this.disallowedTools = [];
      this.additionalTools = [];
      this.useServerManager = false;
      this.adapter = new LangChainAdapter();
      this.telemetry = Telemetry.getInstance();
      this.modelProvider = "remote";
      this.modelName = "remote-agent";
      this.observabilityManager = new ObservabilityManager({
        customCallbacks: options.callbacks,
        agentId: options.agentId,
      });
      this.callbacks = [];
      return;
    }

    // Validate requirements for local execution
    if (!options.llm) {
      throw new Error(
        "llm is required for local execution. For remote execution, provide agentId instead."
      );
    }

    // Detect mode: simplified (string llm) vs explicit (object llm)
    const isSimplifiedMode = typeof options.llm === "string";

    if (isSimplifiedMode) {
      // Simplified mode: llm is string, mcpServers must be provided
      this.isSimplifiedMode = true;
      this.llmString = options.llm as string;
      this.llmConfig = (options as any).llmConfig;
      this.mcpServersConfig = (options as any).mcpServers;

      if (
        !this.mcpServersConfig ||
        Object.keys(this.mcpServersConfig).length === 0
      ) {
        throw new Error(
          "Simplified mode requires 'mcpServers' configuration. " +
            "Provide an object with server configurations, e.g., { filesystem: { command: 'npx', args: [...] } }"
        );
      }

      // LLM and client will be created during initialize()
      this.llm = undefined;
      this.client = undefined;
      this.clientOwnedByAgent = true; // Mark for cleanup
      this.connectors = [];

      logger.info(
        `🎯 Simplified mode enabled: LLM will be created from '${this.llmString}'`
      );
    } else {
      // Explicit mode: llm is object, client or connectors must be provided
      this.isSimplifiedMode = false;
      this.llm = options.llm as LanguageModel;
      this.client = (options as any).client;
      this.connectors = (options as any).connectors ?? [];
      this.clientOwnedByAgent = false;

      if (!this.client && this.connectors.length === 0) {
        throw new Error(
          "Explicit mode requires either 'client' or at least one 'connector'. " +
            "Alternatively, use simplified mode with 'llm' as a string and 'mcpServers' config."
        );
      }
    }

    // Common configuration for both modes
    this.maxSteps = options.maxSteps ?? 5;
    this.autoInitialize = options.autoInitialize ?? false;
    this.memoryEnabled = options.memoryEnabled ?? true;
    this.systemPrompt = options.systemPrompt ?? null;
    this.systemPromptTemplateOverride = options.systemPromptTemplate ?? null;
    this.additionalInstructions = options.additionalInstructions ?? null;
    this.disallowedTools = options.disallowedTools ?? [];
    this.additionalTools = options.additionalTools ?? [];
    this.toolsUsedNames = options.toolsUsedNames ?? [];
    this.useServerManager = options.useServerManager ?? false;
    this.verbose = options.verbose ?? false;
    this.observe = options.observe ?? true;

    // Set up adapter and server manager (only for explicit mode with client)
    if (!this.isSimplifiedMode) {
      if (this.useServerManager) {
        if (!this.client) {
          throw new Error(
            "'client' must be provided when 'useServerManager' is true."
          );
        }
        this.adapter =
          options.adapter ?? new LangChainAdapter(this.disallowedTools);
        this.serverManager =
          options.serverManagerFactory?.(this.client) ??
          new ServerManager(this.client, this.adapter);
      } else {
        this.adapter =
          options.adapter ?? new LangChainAdapter(this.disallowedTools);
      }

      // Initialize telemetry for explicit mode
      this.telemetry = Telemetry.getInstance();
      if (this.llm) {
        const [provider, name] = extractModelInfo(this.llm as any);
        this.modelProvider = provider;
        this.modelName = name;
      } else {
        this.modelProvider = "unknown";
        this.modelName = "unknown";
      }
    } else {
      // For simplified mode, defer adapter/telemetry initialization
      this.adapter =
        options.adapter ?? new LangChainAdapter(this.disallowedTools);
      this.telemetry = Telemetry.getInstance();
      // Model info will be set during initialize()
      this.modelProvider = "unknown";
      this.modelName = "unknown";
    }

    // Set up observability callbacks using the ObservabilityManager
    this.observabilityManager = new ObservabilityManager({
      customCallbacks: options.callbacks,
      verbose: this.verbose,
      observe: this.observe,
      agentId: options.agentId,
      metadataProvider: () => this.getMetadata(),
      tagsProvider: () => this.getTags(),
    });

    // Make getters configurable for test mocking
    Object.defineProperty(this, "agentExecutor", {
      get: () => this._agentExecutor,
      configurable: true,
    });
    Object.defineProperty(this, "tools", {
      get: () => this._tools,
      configurable: true,
    });
    Object.defineProperty(this, "initialized", {
      get: () => this._initialized,
      configurable: true,
    });
  }

  public async initialize(): Promise<void> {
    // Skip initialization for remote agents
    if (this.isRemote) {
      this._initialized = true;
      return;
    }

    logger.info("🚀 Initializing MCP agent and connecting to services...");

    // Handle simplified mode: create client and LLM from configuration
    if (this.isSimplifiedMode) {
      logger.info(
        "🎯 Simplified mode: Creating client and LLM from configuration..."
      );

      // Create MCPClient from mcpServers configuration
      if (this.mcpServersConfig) {
        logger.info(
          `Creating MCPClient with ${Object.keys(this.mcpServersConfig).length} server(s)...`
        );
        this.client = new MCPClient({ mcpServers: this.mcpServersConfig });
        logger.info("✅ MCPClient created successfully");
      }

      // Create LLM from string specification
      if (this.llmString) {
        logger.info(`Creating LLM from string: ${this.llmString}...`);
        try {
          this.llm = await createLLMFromString(this.llmString, this.llmConfig);
          logger.info("✅ LLM created successfully");

          // Update model info for telemetry
          const [provider, name] = extractModelInfo(this.llm as any);
          this.modelProvider = provider;
          this.modelName = name;
        } catch (error: any) {
          throw new Error(
            `Failed to create LLM from string '${this.llmString}': ${error?.message || error}`
          );
        }
      }

      // Set up server manager if needed
      if (this.useServerManager) {
        if (!this.client) {
          throw new Error(
            "'client' must be available when 'useServerManager' is true."
          );
        }
        this.serverManager = new ServerManager(this.client, this.adapter);
      }
    }

    // Initialize observability callbacks
    this.callbacks = await this.observabilityManager.getCallbacks();
    const handlerNames = await this.observabilityManager.getHandlerNames();
    if (handlerNames.length > 0) {
      logger.info(`📊 Observability enabled with: ${handlerNames.join(", ")}`);
    }

    // If using server manager, initialize it
    if (this.useServerManager && this.serverManager) {
      await this.serverManager.initialize();

      // Get server management tools
      const managementTools = this.serverManager.tools;
      this._tools = managementTools;
      this._tools.push(...this.additionalTools);
      logger.info(
        `🔧 Server manager mode active with ${managementTools.length} management tools`
      );

      // Create the system message based on available tools
      await this.createSystemMessageFromTools(this._tools);
    } else {
      // Standard initialization - if using client, get or create sessions
      if (this.client) {
        // First try to get existing sessions
        this.sessions = this.client.getAllActiveSessions();
        logger.info(
          `🔌 Found ${Object.keys(this.sessions).length} existing sessions`
        );

        // Filter out internal code_mode session to check if real MCP servers are connected
        const nonCodeModeSessions = Object.keys(this.sessions).filter(
          (name) => name !== "code_mode"
        );

        // If no active sessions exist (excluding code_mode), create new ones
        if (nonCodeModeSessions.length === 0) {
          logger.info("🔄 No active sessions found, creating new ones...");
          this.sessions = await this.client.createAllSessions();
          logger.info(
            `✅ Created ${Object.keys(this.sessions).length} new sessions`
          );
        }

        // Create LangChain tools directly from the client using the adapter
        // In code mode, only expose the code_mode tools (execute_code, search_tools)
        if (this.client.codeMode) {
          const codeModeSession = this.sessions["code_mode"];
          if (codeModeSession) {
            // Code mode only uses tools, not resources or prompts
            this._tools = await this.adapter.createToolsFromConnectors([
              codeModeSession.connector,
            ]);
            logger.info(`🛠️ Created ${this._tools.length} code mode tools`);
          } else {
            throw new Error(
              "Code mode enabled but code_mode session not found"
            );
          }
        } else {
          // Create tools, resources, and prompts from the client
          const tools = await this.adapter.createToolsFromConnectors(
            Object.values(this.sessions).map((session) => session.connector)
          );
          const resources = await this.adapter.createResourcesFromConnectors(
            Object.values(this.sessions).map((session) => session.connector)
          );
          const prompts = await this.adapter.createPromptsFromConnectors(
            Object.values(this.sessions).map((session) => session.connector)
          );
          this._tools = [...tools, ...resources, ...prompts];
          logger.info(
            `🛠️ Created ${this._tools.length} LangChain items from client: ` +
              `${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts`
          );
        }
        this._tools.push(...this.additionalTools);
      } else {
        // Using direct connector - only establish connection
        logger.info(
          `🔗 Connecting to ${this.connectors.length} direct connectors...`
        );
        for (const connector of this.connectors) {
          if (!connector.isClientConnected) {
            await connector.connect();
          }
        }

        // Create LangChain tools, resources, and prompts using the adapter with connectors
        const tools = await this.adapter.createToolsFromConnectors(
          this.connectors
        );
        const resources = await this.adapter.createResourcesFromConnectors(
          this.connectors
        );
        const prompts = await this.adapter.createPromptsFromConnectors(
          this.connectors
        );
        this._tools = [...tools, ...resources, ...prompts];
        this._tools.push(...this.additionalTools);
        logger.info(
          `🛠️ Created ${this._tools.length} LangChain items from connectors: ` +
            `${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts`
        );
      }

      // Get all tools for system message generation
      logger.info(`🧰 Found ${this._tools.length} tools across all connectors`);

      // Create the system message based on available tools
      await this.createSystemMessageFromTools(this._tools);
    }

    // Create the agent executor and mark initialized
    this._agentExecutor = this.createAgent();
    this._initialized = true;

    // Add MCP server information to observability metadata
    const mcpServerInfo = this.getMCPServerInfo();
    if (Object.keys(mcpServerInfo).length > 0) {
      this.setMetadata(mcpServerInfo);
      logger.debug(
        `MCP server info added to metadata: ${JSON.stringify(mcpServerInfo)}`
      );
    }

    logger.info("✨ Agent initialization complete");
  }

  private async createSystemMessageFromTools(
    tools: StructuredToolInterface[]
  ): Promise<void> {
    const systemPromptTemplate =
      this.systemPromptTemplateOverride ?? DEFAULT_SYSTEM_PROMPT_TEMPLATE;

    this.systemMessage = createSystemMessage(
      tools,
      systemPromptTemplate,
      SERVER_MANAGER_SYSTEM_PROMPT_TEMPLATE,
      this.useServerManager,
      this.disallowedTools,
      this.systemPrompt ?? undefined,
      this.additionalInstructions ?? undefined
    );

    if (this.memoryEnabled) {
      this.conversationHistory = [
        this.systemMessage,
        ...this.conversationHistory.filter(
          (m) => !(m instanceof SystemMessage)
        ),
      ];
    }
  }

  private createAgent(): ReactAgent {
    if (!this.llm) {
      throw new Error("LLM is required to create agent");
    }

    const systemContent =
      (this.systemMessage?.content as string) ?? "You are a helpful assistant.";

    const toolNames = this._tools.map((tool) => tool.name);
    logger.info(`🧠 Agent ready with tools: ${toolNames.join(", ")}`);

    // Create middleware to enforce max_steps
    // modelCallLimitMiddleware limits the number of model calls, which corresponds to agent steps
    const middleware = [modelCallLimitMiddleware({ runLimit: this.maxSteps })];

    const agent = createAgent({
      model: this.llm,
      tools: this._tools as DynamicTool[],
      systemPrompt: systemContent,
      middleware,
    });

    logger.debug(
      `Created agent with max_steps=${this.maxSteps} (via ModelCallLimitMiddleware) and ${this.callbacks.length} callbacks`
    );

    return agent;
  }

  public getConversationHistory(): BaseMessage[] {
    return [...this.conversationHistory];
  }

  public clearConversationHistory(): void {
    this.conversationHistory =
      this.memoryEnabled && this.systemMessage ? [this.systemMessage] : [];
  }

  private addToHistory(message: BaseMessage): void {
    if (this.memoryEnabled) this.conversationHistory.push(message);
  }

  public getSystemMessage(): SystemMessage | null {
    return this.systemMessage;
  }

  public setSystemMessage(message: string): void {
    this.systemMessage = new SystemMessage(message);
    if (this.memoryEnabled) {
      this.conversationHistory = this.conversationHistory.filter(
        (m) => !(m instanceof SystemMessage)
      );
      this.conversationHistory.unshift(this.systemMessage);
    }

    if (this._initialized && this._tools.length) {
      this._agentExecutor = this.createAgent();
      logger.debug("Agent recreated with new system message");
    }
  }

  public setDisallowedTools(disallowedTools: string[]): void {
    this.disallowedTools = disallowedTools;
    this.adapter = new LangChainAdapter(this.disallowedTools);
    if (this._initialized) {
      logger.debug(
        "Agent already initialized. Changes will take effect on next initialization."
      );
    }
  }

  public getDisallowedTools(): string[] {
    return this.disallowedTools;
  }

  /**
   * Set metadata for observability traces
   * @param newMetadata - Key-value pairs to add to metadata. Keys should be strings, values should be serializable.
   */
  public setMetadata(newMetadata: Record<string, any>): void {
    // Validate and sanitize metadata
    const sanitizedMetadata = this.sanitizeMetadata(newMetadata);

    // Merge with existing metadata instead of replacing it
    this.metadata = { ...this.metadata, ...sanitizedMetadata };
    logger.debug(`Metadata set: ${JSON.stringify(this.metadata)}`);
  }

  /**
   * Get current metadata
   * @returns A copy of the current metadata object
   */
  public getMetadata(): Record<string, any> {
    return { ...this.metadata };
  }

  /**
   * Set tags for observability traces
   * @param newTags - Array of tag strings to add. Duplicates will be automatically removed.
   */
  public setTags(newTags: string[]): void {
    // Validate and sanitize tags
    const sanitizedTags = this.sanitizeTags(newTags);
    this.tags = [...new Set([...this.tags, ...sanitizedTags])]; // Remove duplicates
    logger.debug(`Tags set: ${JSON.stringify(this.tags)}`);
  }

  /**
   * Get current tags
   * @returns A copy of the current tags array
   */
  public getTags(): string[] {
    return [...this.tags];
  }

  /**
   * Sanitize metadata to ensure compatibility with observability platforms
   * @param metadata - Raw metadata object
   * @returns Sanitized metadata object
   */
  private sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(metadata)) {
      // Validate key
      if (typeof key !== "string" || key.length === 0) {
        logger.warn(`Invalid metadata key: ${key}. Skipping.`);
        continue;
      }

      // Sanitize key (remove special characters that might cause issues)
      const sanitizedKey = key.replace(/[^\w-]/g, "_");

      // Validate and sanitize value
      if (value === null || value === undefined) {
        sanitized[sanitizedKey] = value;
      } else if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        sanitized[sanitizedKey] = value;
      } else if (Array.isArray(value)) {
        // Only allow arrays of primitives
        const sanitizedArray = value.filter(
          (item) =>
            typeof item === "string" ||
            typeof item === "number" ||
            typeof item === "boolean"
        );
        if (sanitizedArray.length > 0) {
          sanitized[sanitizedKey] = sanitizedArray;
        }
      } else if (typeof value === "object") {
        // Try to serialize objects, but limit depth to prevent circular references
        try {
          const serialized = JSON.stringify(value);
          if (serialized.length > 1000) {
            logger.warn(
              `Metadata value for key '${sanitizedKey}' is too large. Truncating.`
            );
            sanitized[sanitizedKey] = `${serialized.substring(0, 1000)}...`;
          } else {
            sanitized[sanitizedKey] = value;
          }
        } catch (error) {
          logger.warn(
            `Failed to serialize metadata value for key '${sanitizedKey}': ${error}. Skipping.`
          );
        }
      } else {
        logger.warn(
          `Unsupported metadata value type for key '${sanitizedKey}': ${typeof value}. Skipping.`
        );
      }
    }

    return sanitized;
  }

  /**
   * Sanitize tags to ensure compatibility with observability platforms
   * @param tags - Array of tag strings
   * @returns Array of sanitized tag strings
   */
  private sanitizeTags(tags: string[]): string[] {
    return tags
      .filter((tag) => typeof tag === "string" && tag.length > 0)
      .map((tag) => tag.replace(/[^\w:-]/g, "_"))
      .filter((tag) => tag.length <= 50); // Limit tag length
  }

  /**
   * Get MCP server information for observability metadata
   */
  private getMCPServerInfo(): Record<string, any> {
    const serverInfo: Record<string, any> = {};

    try {
      if (this.client) {
        const serverNames = this.client.getServerNames();
        serverInfo.mcp_servers_count = serverNames.length;
        serverInfo.mcp_server_names = serverNames;

        // Get server types and configurations
        const serverConfigs: Record<string, any> = {};
        for (const serverName of serverNames) {
          try {
            const config = this.client.getServerConfig(serverName);
            if (config) {
              // Determine server type based on configuration
              let serverType = "unknown";
              if (config.command) {
                serverType = "command";
              } else if (config.url) {
                serverType = "http";
              } else if (config.ws_url) {
                serverType = "websocket";
              }

              serverConfigs[serverName] = {
                type: serverType,
                // Include safe configuration details (avoid sensitive data)
                has_args: !!config.args,
                has_env: !!config.env,
                has_headers: !!config.headers,
                url: config.url || null,
                command: config.command || null,
              };
            }
          } catch (error) {
            logger.warn(
              `Failed to get config for server '${serverName}': ${error}`
            );
            serverConfigs[serverName] = {
              type: "error",
              error: "config_unavailable",
            };
          }
        }
        serverInfo.mcp_server_configs = serverConfigs;
      } else if (this.connectors && this.connectors.length > 0) {
        // Handle direct connectors
        serverInfo.mcp_servers_count = this.connectors.length;
        serverInfo.mcp_server_names = this.connectors.map(
          (c) => c.publicIdentifier
        );
        serverInfo.mcp_server_types = this.connectors.map(
          (c) => c.constructor.name
        );
      }
    } catch (error) {
      logger.warn(`Failed to collect MCP server info: ${error}`);
      serverInfo.error = "collection_failed";
    }

    return serverInfo;
  }

  private _normalizeOutput(value: any): string {
    /**
     * Normalize model outputs into a plain text string.
     * Similar to Python's _normalize_output method.
     */
    try {
      if (typeof value === "string") {
        return value;
      }

      // LangChain messages may have .content which is str or list-like
      if (value && typeof value === "object" && "content" in value) {
        return this._normalizeOutput(value.content);
      }

      if (Array.isArray(value)) {
        const parts: string[] = [];
        for (const item of value) {
          if (typeof item === "object" && item !== null) {
            if ("text" in item && typeof item.text === "string") {
              parts.push(item.text);
            } else if ("content" in item) {
              parts.push(this._normalizeOutput(item.content));
            } else {
              // Fallback to string for unknown shapes
              parts.push(String(item));
            }
          } else {
            // recurse on .text or str
            const partText =
              item && typeof item === "object" && "text" in item
                ? item.text
                : null;
            if (typeof partText === "string") {
              parts.push(partText);
            } else {
              const partContent =
                item && typeof item === "object" && "content" in item
                  ? item.content
                  : item;
              parts.push(this._normalizeOutput(partContent));
            }
          }
        }
        return parts.join("");
      }

      return String(value);
    } catch (error) {
      return String(value);
    }
  }

  /**
   * Check if a message is AI/assistant-like regardless of whether it's a class instance.
   * Handles version mismatches, serialization boundaries, and different message formats.
   *
   * This method solves the issue where messages from LangChain agents may be plain JavaScript
   * objects (e.g., `{ type: 'ai', content: '...' }`) instead of AIMessage instances due to
   * serialization/deserialization across module boundaries or version mismatches.
   *
   * @example
   * // Real AIMessage instance (standard case)
   * _isAIMessageLike(new AIMessage("hello")) // => true
   *
   * @example
   * // Plain object after serialization (fixes issue #446)
   * _isAIMessageLike({ type: "ai", content: "hello" }) // => true
   *
   * @example
   * // OpenAI-style format with role
   * _isAIMessageLike({ role: "assistant", content: "hello" }) // => true
   *
   * @example
   * // Object with getType() method
   * _isAIMessageLike({ getType: () => "ai", content: "hello" }) // => true
   *
   * @param message - The message object to check
   * @returns true if the message represents an AI/assistant message
   */
  private _isAIMessageLike(message: unknown): message is
    | AIMessage
    | {
        type: "ai" | "assistant";
        content?: unknown;
        tool_calls?: unknown;
      }
    | {
        role: "ai" | "assistant";
        content?: unknown;
        tool_calls?: unknown;
      } {
    // Fast path: check if it's an actual AIMessage instance
    if (message instanceof AIMessage) {
      return true;
    }

    // Relaxed check: just need to be an object (content is optional as messages might only have tool_calls)
    if (typeof message !== "object" || message === null) {
      return false;
    }

    // Check for type/role properties that indicate an assistant message
    // Support multiple formats from different LangChain versions
    const msg = message as any;

    // Try methods first (for partially deserialized objects)
    if (typeof msg.getType === "function") {
      try {
        const type = msg.getType();
        if (type === "ai" || type === "assistant") {
          return true;
        }
      } catch (error) {
        // If getType() throws, fall through to other checks
        // Note: Silent failure here to avoid performance impact in hot path
      }
    }
    if (typeof msg._getType === "function") {
      try {
        const type = msg._getType();
        if (type === "ai" || type === "assistant") {
          return true;
        }
      } catch (error) {
        // If _getType() throws, fall through to other checks
        // Note: Silent failure here to avoid performance impact in hot path
      }
    }

    // Check direct properties
    if ("type" in msg) {
      return msg.type === "ai" || msg.type === "assistant";
    }
    if ("role" in msg) {
      return msg.role === "ai" || msg.role === "assistant";
    }

    return false;
  }

  /**
   * Check if a message has tool calls, handling both class instances and plain objects.
   * Safely checks for tool_calls array presence.
   *
   * @example
   * // AIMessage with tool calls
   * const msg = new AIMessage({ content: "", tool_calls: [{ name: "add", args: {} }] });
   * _messageHasToolCalls(msg) // => true
   *
   * @example
   * // Plain object with tool calls
   * _messageHasToolCalls({ type: "ai", tool_calls: [{ name: "add" }] }) // => true
   *
   * @example
   * // Message without tool calls
   * _messageHasToolCalls({ type: "ai", content: "hello" }) // => false
   *
   * @param message - The message object to check
   * @returns true if the message has non-empty tool_calls array
   */
  private _messageHasToolCalls(message: unknown): boolean {
    if (
      typeof message === "object" &&
      message !== null &&
      "tool_calls" in message &&
      Array.isArray((message as { tool_calls?: unknown }).tool_calls)
    ) {
      return (message as { tool_calls: unknown[] }).tool_calls.length > 0;
    }

    return false;
  }

  /**
   * Check if a message is a HumanMessage-like object.
   * Handles both class instances and plain objects from serialization.
   *
   * @example
   * _isHumanMessageLike(new HumanMessage("hello")) // => true
   * _isHumanMessageLike({ type: "human", content: "hello" }) // => true
   *
   * @param message - The message object to check
   * @returns true if the message represents a human message
   */
  private _isHumanMessageLike(message: unknown): boolean {
    if (message instanceof HumanMessage) {
      return true;
    }
    if (typeof message !== "object" || message === null) {
      return false;
    }
    const msg = message as any;

    // Try methods first
    if (typeof msg.getType === "function") {
      try {
        const type = msg.getType();
        if (type === "human" || type === "user") {
          return true;
        }
      } catch (error) {
        // Silent failure for performance
      }
    }

    // Check direct properties
    if ("type" in msg && (msg.type === "human" || msg.type === "user")) {
      return true;
    }
    if ("role" in msg && (msg.role === "human" || msg.role === "user")) {
      return true;
    }

    return false;
  }

  /**
   * Check if a message is a ToolMessage-like object.
   * Handles both class instances and plain objects from serialization.
   *
   * @example
   * _isToolMessageLike(new ToolMessage({ content: "result", tool_call_id: "123" })) // => true
   * _isToolMessageLike({ type: "tool", content: "result" }) // => true
   *
   * @param message - The message object to check
   * @returns true if the message represents a tool message
   */
  private _isToolMessageLike(message: unknown): boolean {
    if (message instanceof ToolMessage) {
      return true;
    }
    if (typeof message !== "object" || message === null) {
      return false;
    }
    const msg = message as any;

    // Try methods first
    if (typeof msg.getType === "function") {
      try {
        const type = msg.getType();
        if (type === "tool") {
          return true;
        }
      } catch (error) {
        // Silent failure for performance
      }
    }

    // Check direct properties
    if ("type" in msg && msg.type === "tool") {
      return true;
    }

    return false;
  }

  /**
   * Extract content from a message, handling both AIMessage instances and plain objects.
   *
   * @example
   * // From AIMessage instance
   * _getMessageContent(new AIMessage("hello")) // => "hello"
   *
   * @example
   * // From plain object
   * _getMessageContent({ type: "ai", content: "hello" }) // => "hello"
   *
   * @param message - The message object to extract content from
   * @returns The content of the message, or undefined if not present
   */
  private _getMessageContent(message: unknown): unknown {
    if (message instanceof AIMessage) {
      return message.content;
    }
    if (message && typeof message === "object" && "content" in message) {
      return (message as { content: unknown }).content;
    }
    return undefined;
  }

  private async _consumeAndReturn<T>(
    generator: AsyncGenerator<AgentStep, string | T, void>
  ): Promise<string | T> {
    // Manually iterate through the generator to consume the steps.
    // The for-await-of loop is not used because it discards the generator's
    // final return value. We need to capture that value when `done` is true.
    while (true) {
      const { done, value } = await generator.next();
      if (done) {
        return value;
      }
    }
  }

  /**
   * Runs the agent with options object and returns a promise for the final result.
   */
  public async run(options: RunOptions): Promise<string>;

  /**
   * Runs the agent with options object and structured output, returns a promise for the typed result.
   */
  public async run<T>(options: RunOptions<T>): Promise<T>;

  /**
   * Runs the agent and returns a promise for the final result.
   * @deprecated Use options object instead: run({ prompt, maxSteps, ... })
   */
  public async run(
    query: string,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: BaseMessage[]
  ): Promise<string>;

  /**
   * Runs the agent with structured output and returns a promise for the typed result.
   * @deprecated Use options object instead: run({ prompt, schema, maxSteps, ... })
   */
  public async run<T>(
    query: string,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: BaseMessage[],
    outputSchema?: ZodSchema<T>
  ): Promise<T>;

  public async run<T>(
    queryOrOptions: string | RunOptions<T>,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: BaseMessage[],
    outputSchema?: ZodSchema<T>
  ): Promise<string | T> {
    // Normalize input to internal parameters
    const {
      query,
      maxSteps: steps,
      manageConnector: manage,
      externalHistory: history,
      outputSchema: schema,
    } = normalizeRunOptions(
      queryOrOptions,
      maxSteps,
      manageConnector,
      externalHistory,
      outputSchema
    );

    // Delegate to remote agent if in remote mode
    if (this.isRemote && this.remoteAgent) {
      return this.remoteAgent.run(query, steps, manage, history, schema);
    }

    const generator = this.stream<T>(query, steps, manage, history, schema);
    return this._consumeAndReturn(generator);
  }

  /**
   * Streams the agent execution with options object and returns string result.
   */
  public async *stream(
    options: RunOptions
  ): AsyncGenerator<AgentStep, string, void>;

  /**
   * Streams the agent execution with options object and structured output.
   */
  public async *stream<T>(
    options: RunOptions<T>
  ): AsyncGenerator<AgentStep, T, void>;

  /**
   * Streams the agent execution and yields agent steps.
   * @deprecated Use options object instead: stream({ prompt, maxSteps, ... })
   */
  public async *stream<T = string>(
    query: string,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: BaseMessage[],
    outputSchema?: ZodSchema<T>
  ): AsyncGenerator<AgentStep, string | T, void>;

  public async *stream<T = string>(
    queryOrOptions: string | RunOptions<T>,
    maxSteps?: number,
    manageConnector = true,
    externalHistory?: BaseMessage[],
    outputSchema?: ZodSchema<T>
  ): AsyncGenerator<AgentStep, string | T, void> {
    // Normalize input to internal parameters
    const {
      query,
      maxSteps: steps,
      manageConnector: manage,
      externalHistory: history,
      outputSchema: schema,
    } = normalizeRunOptions(
      queryOrOptions,
      maxSteps,
      manageConnector,
      externalHistory,
      outputSchema
    );

    // Delegate to remote agent if in remote mode
    if (this.isRemote && this.remoteAgent) {
      const result = await this.remoteAgent.run(
        query,
        steps,
        manage,
        history,
        schema
      );
      return result as string | T;
    }

    let initializedHere = false;
    const startTime = Date.now();
    let success = false;
    let finalOutput: string | null = null;
    let stepsTaken = 0;

    try {
      // 1. Initialize if needed
      if (manage && !this._initialized) {
        await this.initialize();
        initializedHere = true;
      } else if (!this._initialized && this.autoInitialize) {
        await this.initialize();
        initializedHere = true;
      }

      if (!this._agentExecutor) {
        throw new Error("MCP agent failed to initialize");
      }

      // Check for tool updates before starting execution (if using server manager)
      if (this.useServerManager && this.serverManager) {
        const currentTools = this.serverManager.tools;
        const currentToolNames = new Set(currentTools.map((t) => t.name));
        const existingToolNames = new Set(this._tools.map((t) => t.name));

        if (
          currentToolNames.size !== existingToolNames.size ||
          [...currentToolNames].some((n) => !existingToolNames.has(n))
        ) {
          logger.info(
            `🔄 Tools changed before execution, updating agent. New tools: ${[...currentToolNames].join(", ")}`
          );
          this._tools = currentTools;
          this._tools.push(...this.additionalTools);
          // Regenerate system message with ALL current tools
          await this.createSystemMessageFromTools(this._tools);
          // Recreate the agent executor with the new tools and system message
          this._agentExecutor = this.createAgent();
        }
      }

      // 2. Build inputs for the agent
      const historyToUse = history ?? this.conversationHistory;

      // Convert messages to format expected by LangChain agent
      const langchainHistory: BaseMessage[] = [];
      for (const msg of historyToUse) {
        if (
          this._isHumanMessageLike(msg) ||
          this._isAIMessageLike(msg) ||
          this._isToolMessageLike(msg)
        ) {
          langchainHistory.push(msg);
        }
      }

      const displayQuery =
        query.length > 50
          ? `${query.slice(0, 50).replace(/\n/g, " ")}...`
          : query.replace(/\n/g, " ");
      logger.info(`💬 Received query: '${displayQuery}'`);
      logger.info("🏁 Starting agent execution");

      // 3. Stream using the built-in astream from CompiledStateGraph
      // The agent graph handles the loop internally
      // With dynamic tool reload: if tools change mid-execution, we interrupt and restart
      const maxRestarts = 3; // Prevent infinite restart loops
      let restartCount = 0;
      const accumulatedMessages: BaseMessage[] = [
        ...langchainHistory,
        new HumanMessage(query),
      ];

      while (restartCount <= maxRestarts) {
        // Update inputs with accumulated messages
        const inputs = { messages: accumulatedMessages };
        let shouldRestart = false;

        // Stream agent updates with observability callbacks
        const stream = await this._agentExecutor.stream(inputs, {
          streamMode: "updates", // Get updates as they happen
          callbacks: this.callbacks,
          metadata: this.getMetadata(),
          tags: this.getTags(),
          // Set trace name for LangChain/Langfuse
          runName: this.metadata.trace_name || "mcp-use-agent",
          // Set recursion limit to 3x maxSteps to account for model calls + tool executions
          recursionLimit: this.maxSteps * 3,
          // Pass sessionId for Langfuse if present in metadata
          ...(this.metadata.session_id && {
            sessionId: this.metadata.session_id,
          }),
        });

        for await (const chunk of stream) {
          // chunk is a dict with node names as keys
          // The agent node will have 'messages' with the AI response
          // The tools node will have 'messages' with tool calls and results

          for (const [nodeName, nodeOutput] of Object.entries(chunk)) {
            logger.debug(
              `📦 Node '${nodeName}' output: ${JSON.stringify(nodeOutput)}`
            );

            // Extract messages from the node output and accumulate them
            if (
              nodeOutput &&
              typeof nodeOutput === "object" &&
              "messages" in nodeOutput
            ) {
              let messages = (nodeOutput as any).messages;
              if (!Array.isArray(messages)) {
                messages = [messages];
              }

              // Add new messages to accumulated messages for potential restart
              for (const msg of messages) {
                if (!accumulatedMessages.includes(msg)) {
                  accumulatedMessages.push(msg);
                }
              }

              for (const message of messages) {
                // Track tool calls
                if (
                  "tool_calls" in message &&
                  Array.isArray(message.tool_calls) &&
                  message.tool_calls.length > 0
                ) {
                  for (const toolCall of message.tool_calls) {
                    const toolName = toolCall.name || "unknown";
                    const toolInput = toolCall.args || {};
                    this.toolsUsedNames.push(toolName);
                    stepsTaken++;

                    let toolInputStr = JSON.stringify(toolInput);
                    if (toolInputStr.length > 100) {
                      toolInputStr = `${toolInputStr.slice(0, 97)}...`;
                    }
                    logger.info(
                      `🔧 Tool call: ${toolName} with input: ${toolInputStr}`
                    );

                    // Yield tool call as AgentStep
                    yield {
                      action: {
                        tool: toolName,
                        toolInput,
                        log: `Calling tool ${toolName}`,
                      },
                      observation: "", // Will be filled in by tool result
                    };
                  }
                }

                // Track tool results (ToolMessage)
                if (this._isToolMessageLike(message)) {
                  const observation = message.content;
                  let observationStr = String(observation);
                  if (observationStr.length > 100) {
                    observationStr = `${observationStr.slice(0, 97)}...`;
                  }
                  observationStr = observationStr.replace(/\n/g, " ");
                  logger.info(`📄 Tool result: ${observationStr}`);

                  // --- Check for tool updates after tool results (safe restart point) ---
                  if (this.useServerManager && this.serverManager) {
                    const currentTools = this.serverManager.tools;
                    const currentToolNames = new Set(
                      currentTools.map((t) => t.name)
                    );
                    const existingToolNames = new Set(
                      this._tools.map((t) => t.name)
                    );

                    if (
                      currentToolNames.size !== existingToolNames.size ||
                      [...currentToolNames].some(
                        (n) => !existingToolNames.has(n)
                      )
                    ) {
                      logger.info(
                        `🔄 Tools changed during execution. New tools: ${[...currentToolNames].join(", ")}`
                      );
                      this._tools = currentTools;
                      this._tools.push(...this.additionalTools);
                      // Regenerate system message with ALL current tools
                      await this.createSystemMessageFromTools(this._tools);
                      // Recreate the agent executor with the new tools and system message
                      this._agentExecutor = this.createAgent();

                      // Set restart flag - safe to restart now after tool results
                      shouldRestart = true;
                      restartCount++;
                      logger.info(
                        `🔃 Restarting execution with updated tools (restart ${restartCount}/${maxRestarts})`
                      );
                      break; // Break out of the message loop
                    }
                  }
                }

                // Track final AI message (without tool calls = final response)
                if (
                  this._isAIMessageLike(message) &&
                  !this._messageHasToolCalls(message)
                ) {
                  finalOutput = this._normalizeOutput(
                    this._getMessageContent(message)
                  );
                  logger.info("✅ Agent finished with output");
                }
              }

              // Break out of node loop if restarting
              if (shouldRestart) {
                break;
              }
            }
          }

          // Break out of chunk loop if restarting
          if (shouldRestart) {
            break;
          }
        }

        // Check if we should restart or if execution completed
        if (!shouldRestart) {
          // Execution completed successfully without tool changes
          break;
        }

        // If we've hit max restarts, log warning and continue
        if (restartCount > maxRestarts) {
          logger.warn(
            `⚠️ Max restarts (${maxRestarts}) reached. Continuing with current tools.`
          );
          break;
        }
      }

      // 4. Update conversation history
      if (this.memoryEnabled) {
        // Store all messages from execution (including tool calls and tool outputs)
        // Extract messages from current execution (skip the messages that were already in history)
        const newMessages = accumulatedMessages.slice(langchainHistory.length);
        for (const msg of newMessages) {
          this.addToHistory(msg);
        }
      }

      // 5. Handle structured output if requested
      if (schema && finalOutput) {
        try {
          logger.info("🔧 Attempting structured output...");
          const structuredResult = await this._attemptStructuredOutput<T>(
            finalOutput,
            this.llm!,
            schema
          );

          if (this.memoryEnabled) {
            this.addToHistory(
              new AIMessage(
                `Structured result: ${JSON.stringify(structuredResult)}`
              )
            );
          }

          logger.info("✅ Structured output successful");
          success = true;
          return structuredResult;
        } catch (e) {
          logger.error(`❌ Structured output failed: ${e}`);
          throw new Error(
            `Failed to generate structured output: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }

      // 6. Yield final result
      logger.info(
        `🎉 Agent execution complete in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`
      );
      success = true;
      return (finalOutput || "No output generated") as string | T;
    } catch (e) {
      logger.error(`❌ Error running query: ${e}`);
      if (initializedHere && manage) {
        logger.info("🧹 Cleaning up resources after error");
        await this.close();
      }
      throw e;
    } finally {
      // Track comprehensive execution data
      const executionTimeMs = Date.now() - startTime;

      let serverCount = 0;
      if (this.client) {
        serverCount = Object.keys(this.client.getAllActiveSessions()).length;
      } else if (this.connectors) {
        serverCount = this.connectors.length;
      }

      const conversationHistoryLength = this.memoryEnabled
        ? this.conversationHistory.length
        : 0;

      // Safely access _tools in case initialization failed
      const toolsAvailable = this._tools || [];

      await this.telemetry.trackAgentExecution({
        executionMethod: "stream",
        query,
        success,
        modelProvider: this.modelProvider,
        modelName: this.modelName,
        serverCount,
        serverIdentifiers: this.connectors.map(
          (connector) => connector.publicIdentifier
        ),
        totalToolsAvailable: toolsAvailable.length,
        toolsAvailableNames: toolsAvailable.map((t) => t.name),
        maxStepsConfigured: this.maxSteps,
        memoryEnabled: this.memoryEnabled,
        useServerManager: this.useServerManager,
        maxStepsUsed: steps ?? null,
        manageConnector: manage,
        externalHistoryUsed: history !== undefined,
        stepsTaken,
        toolsUsedCount: this.toolsUsedNames.length,
        toolsUsedNames: this.toolsUsedNames,
        response: finalOutput || "",
        executionTimeMs,
        errorType: success ? null : "execution_error",
        conversationHistoryLength,
      });

      // Clean up if necessary
      if (manage && !this.client && initializedHere) {
        logger.info("🧹 Closing agent after stream completion");
        await this.close();
      }
    }
  }
  /**
   * Flush observability traces to the configured observability platform.
   * Important for serverless environments where traces need to be sent before function termination.
   */
  public async flush(): Promise<void> {
    // Delegate to remote agent if in remote mode
    if (this.isRemote && this.remoteAgent) {
      // Remote agents don't have observability manager
      return;
    }

    logger.debug("Flushing observability traces...");
    await this.observabilityManager.flush();
  }

  public async close(): Promise<void> {
    // Delegate to remote agent if in remote mode
    if (this.isRemote && this.remoteAgent) {
      await this.remoteAgent.close();
      return;
    }

    logger.info("🔌 Closing MCPAgent resources…");

    // Shutdown observability handlers (important for serverless)
    await this.observabilityManager.shutdown();
    try {
      this._agentExecutor = null;
      this._tools = [];

      // Clean up client (always close if we own it, or if it exists in explicit mode)
      if (this.client) {
        // In simplified mode, we always own the client and should close it
        // In explicit mode, we only close if explicitly requested (current behavior)
        if (this.clientOwnedByAgent) {
          logger.info(
            "🔄 Closing internally-created client (simplified mode) and cleaning up resources"
          );
          await this.client.close();
          this.sessions = {};
          this.client = undefined;
        } else {
          logger.info("🔄 Closing client and cleaning up resources");
          await this.client.close();
          this.sessions = {};
        }
      } else {
        for (const connector of this.connectors) {
          logger.info("🔄 Disconnecting connector");
          await connector.disconnect();
        }
      }

      // Clean up LLM reference (important for simplified mode)
      if (this.isSimplifiedMode && this.llm) {
        logger.debug("🔄 Clearing LLM reference (simplified mode)");
        this.llm = undefined;
      }

      if ("connectorToolMap" in this.adapter) {
        this.adapter = new LangChainAdapter();
      }
    } finally {
      this._initialized = false;
      logger.info("👋 Agent closed successfully");
    }
  }

  /**
   * Yields with pretty-printed output for code mode with options object.
   */
  public async *prettyStreamEvents(
    options: RunOptions
  ): AsyncGenerator<void, string, void>;

  /**
   * Yields with pretty-printed output for code mode with options object and structured output.
   */
  public async *prettyStreamEvents<T>(
    options: RunOptions<T>
  ): AsyncGenerator<void, string, void>;

  /**
   * Yields with pretty-printed output for code mode.
   * This method formats and displays tool executions in a user-friendly way with syntax highlighting.
   * @deprecated Use options object instead: prettyStreamEvents({ prompt, maxSteps, ... })
   */
  public async *prettyStreamEvents<T = string>(
    query: string,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: BaseMessage[],
    outputSchema?: ZodSchema<T>
  ): AsyncGenerator<void, string, void>;

  public async *prettyStreamEvents<T = string>(
    queryOrOptions: string | RunOptions<T>,
    maxSteps?: number,
    manageConnector = true,
    externalHistory?: BaseMessage[],
    outputSchema?: ZodSchema<T>
  ): AsyncGenerator<void, string, void> {
    const { prettyStreamEvents: prettyStream } = await import("./display.js");

    const finalResponse = "";

    for await (const _ of prettyStream(
      this.streamEvents(
        queryOrOptions as any,
        maxSteps,
        manageConnector,
        externalHistory,
        outputSchema
      )
    )) {
      yield;
    }

    return finalResponse;
  }

  /**
   * Yields LangChain StreamEvent objects with options object.
   */
  public async *streamEvents(
    options: RunOptions
  ): AsyncGenerator<StreamEvent, void, void>;

  /**
   * Yields LangChain StreamEvent objects with options object and structured output.
   */
  public async *streamEvents<T>(
    options: RunOptions<T>
  ): AsyncGenerator<StreamEvent, void, void>;

  /**
   * Yields LangChain StreamEvent objects from the underlying streamEvents() method.
   * This provides token-level streaming and fine-grained event updates.
   * @deprecated Use options object instead: streamEvents({ prompt, maxSteps, ... })
   */
  public async *streamEvents<T = string>(
    query: string,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: BaseMessage[],
    outputSchema?: ZodSchema<T>
  ): AsyncGenerator<StreamEvent, void, void>;

  public async *streamEvents<T = string>(
    queryOrOptions: string | RunOptions<T>,
    maxSteps?: number,
    manageConnector = true,
    externalHistory?: BaseMessage[],
    outputSchema?: ZodSchema<T>
  ): AsyncGenerator<StreamEvent, void, void> {
    // Normalize input to internal parameters
    const normalized = normalizeRunOptions(
      queryOrOptions,
      maxSteps,
      manageConnector,
      externalHistory,
      outputSchema
    );
    let { query } = normalized;
    const {
      maxSteps: steps,
      manageConnector: manage,
      externalHistory: history,
      outputSchema: schema,
    } = normalized;

    let initializedHere = false;
    const startTime = Date.now();
    let success = false;
    let eventCount = 0;
    let totalResponseLength = 0;
    let finalResponse = "";

    // Enhance query with schema information if structured output is requested
    if (schema) {
      query = this._enhanceQueryWithSchema(query, schema);
    }

    try {
      // Initialize if needed
      if (manage && !this._initialized) {
        await this.initialize();
        initializedHere = true;
      } else if (!this._initialized && this.autoInitialize) {
        await this.initialize();
        initializedHere = true;
      }

      const agentExecutor = this._agentExecutor;
      if (!agentExecutor) {
        throw new Error("MCP agent failed to initialize");
      }

      // Set max iterations
      this.maxSteps = steps ?? this.maxSteps;

      const display_query =
        typeof query === "string" && query.length > 50
          ? `${query.slice(0, 50).replace(/\n/g, " ")}...`
          : typeof query === "string"
            ? query.replace(/\n/g, " ")
            : String(query);
      logger.info(`💬 Received query for streamEvents: '${display_query}'`);

      // Add user message to history if memory enabled
      if (this.memoryEnabled) {
        logger.info(`🔄 Adding user message to history: ${display_query}`);
        this.addToHistory(new HumanMessage({ content: query }));
      }

      // Prepare history
      const historyToUse = history ?? this.conversationHistory;
      const langchainHistory: BaseMessage[] = [];
      for (const msg of historyToUse) {
        if (
          this._isHumanMessageLike(msg) ||
          this._isAIMessageLike(msg) ||
          this._isToolMessageLike(msg)
        ) {
          langchainHistory.push(msg);
        } else {
          logger.info(
            `⚠️ Skipped message of type: ${msg.constructor?.name || typeof msg}`
          );
        }
      }

      // Prepare inputs
      const inputs: BaseMessage[] = [
        ...langchainHistory,
        new HumanMessage(query),
      ];

      logger.info("callbacks", this.callbacks);

      // Stream events from the agent executor with observability support
      const eventStream = agentExecutor.streamEvents(
        { messages: inputs },
        {
          streamMode: "messages",
          version: "v2",
          callbacks: this.callbacks,
          metadata: this.getMetadata(),
          tags: this.getTags(),
          // Set trace name for LangChain/Langfuse
          runName: this.metadata.trace_name || "mcp-use-agent",
          // Set recursion limit to 3x maxSteps to account for model calls + tool executions
          recursionLimit: this.maxSteps * 3,
          // Pass sessionId for Langfuse if present in metadata
          ...(this.metadata.session_id && {
            sessionId: this.metadata.session_id,
          }),
        }
      );

      // Yield each event
      for await (const event of eventStream) {
        eventCount++;

        // Skip null or invalid events
        if (!event || typeof event !== "object") {
          continue;
        }

        // Track response length for telemetry
        if (
          event.event === "on_chat_model_stream" &&
          event.data?.chunk?.content
        ) {
          totalResponseLength += event.data.chunk.content.length;
        }

        // Capture AI message content as it streams
        if (event.event === "on_chat_model_stream" && event.data?.chunk) {
          const chunk = event.data.chunk;
          if (chunk.content) {
            if (!finalResponse) {
              finalResponse = "";
            }
            // Normalize the content to ensure it's a string
            const normalizedContent = this._normalizeOutput(chunk.content);
            finalResponse += normalizedContent;
            logger.debug(
              `📝 Accumulated response length: ${finalResponse.length}`
            );
          }
        }

        yield event;

        // Capture final response from chain end event (fallback)
        if (
          event.event === "on_chain_end" &&
          event.data?.output &&
          !finalResponse
        ) {
          const output = event.data.output;
          if (Array.isArray(output) && output.length > 0 && output[0]?.text) {
            finalResponse = output[0].text;
          } else if (typeof output === "string") {
            finalResponse = output;
          } else if (
            output &&
            typeof output === "object" &&
            "output" in output
          ) {
            finalResponse = output.output;
          }
        }
      }

      // Convert to structured output if requested
      if (schema && finalResponse) {
        logger.info("🔧 Attempting structured output conversion...");

        try {
          // Start the conversion (non-blocking)
          let conversionCompleted = false;
          let conversionResult: T | null = null;
          let conversionError: Error | null = null;

          this._attemptStructuredOutput<T>(finalResponse, this.llm!, schema)
            .then((result) => {
              conversionCompleted = true;
              conversionResult = result;
              return result;
            })
            .catch((error) => {
              conversionCompleted = true;
              conversionError = error;
              throw error;
            });

          // Yield progress events while conversion is running
          let progressCount = 0;

          while (!conversionCompleted) {
            // Wait 2 seconds
            await new Promise((resolve) => setTimeout(resolve, 2000));

            if (!conversionCompleted) {
              // Still running - yield progress event
              progressCount++;
              yield {
                event: "on_structured_output_progress",
                data: {
                  message: `Converting to structured output... (${progressCount * 2}s)`,
                  elapsed: progressCount * 2,
                },
              } as unknown as StreamEvent;
            }
          }

          // Check if conversion succeeded or failed
          if (conversionError) {
            throw conversionError;
          }

          if (conversionResult) {
            // Yield structured result as a custom event
            yield {
              event: "on_structured_output",
              data: { output: conversionResult },
            } as unknown as StreamEvent;

            if (this.memoryEnabled) {
              this.addToHistory(
                new AIMessage(
                  `Structured result: ${JSON.stringify(conversionResult)}`
                )
              );
            }

            logger.info("✅ Structured output successful");
          }
        } catch (e) {
          logger.warn(`⚠️ Structured output failed: ${e}`);
          // Yield error event
          yield {
            event: "on_structured_output_error",
            data: { error: e instanceof Error ? e.message : String(e) },
          } as unknown as StreamEvent;
        }
      } else if (this.memoryEnabled && finalResponse) {
        // Add the final AI response to conversation history if memory is enabled
        this.addToHistory(new AIMessage(finalResponse));
      }
      console.log("\n\n");
      logger.info(`🎉 StreamEvents complete - ${eventCount} events emitted`);
      success = true;
    } catch (e) {
      logger.error(`❌ Error during streamEvents: ${e}`);
      if (initializedHere && manage) {
        logger.info(
          "🧹 Cleaning up resources after initialization error in streamEvents"
        );
        await this.close();
      }
      throw e;
    } finally {
      // Track telemetry
      const executionTimeMs = Date.now() - startTime;

      let serverCount = 0;
      if (this.client) {
        serverCount = Object.keys(this.client.getAllActiveSessions()).length;
      } else if (this.connectors) {
        serverCount = this.connectors.length;
      }

      const conversationHistoryLength = this.memoryEnabled
        ? this.conversationHistory.length
        : 0;

      await this.telemetry.trackAgentExecution({
        executionMethod: "streamEvents",
        query,
        success,
        modelProvider: this.modelProvider,
        modelName: this.modelName,
        serverCount,
        serverIdentifiers: this.connectors.map(
          (connector) => connector.publicIdentifier
        ),
        totalToolsAvailable: this._tools.length,
        toolsAvailableNames: this._tools.map((t) => t.name),
        maxStepsConfigured: this.maxSteps,
        memoryEnabled: this.memoryEnabled,
        useServerManager: this.useServerManager,
        maxStepsUsed: steps ?? null,
        manageConnector: manage,
        externalHistoryUsed: history !== undefined,
        response: `[STREAMED RESPONSE - ${totalResponseLength} chars]`,
        executionTimeMs,
        errorType: success ? null : "streaming_error",
        conversationHistoryLength,
      });

      // Clean up if needed
      if (manage && !this.client && initializedHere) {
        logger.info("🧹 Closing agent after streamEvents completion");
        await this.close();
      }
    }
  }

  /**
   * Attempt to create structured output from raw result with validation and retry logic.
   *
   * @param rawResult - The raw text result from the agent
   * @param llm - LLM to use for structured output
   * @param outputSchema - The Zod schema to validate against
   */
  private async _attemptStructuredOutput<T>(
    rawResult: string | any,
    llm: LanguageModel,
    outputSchema: ZodSchema<T>
  ): Promise<T> {
    logger.info(
      `🔄 Attempting structured output with schema: ${JSON.stringify(outputSchema, null, 2)}`
    );
    logger.info(`🔄 Raw result: ${JSON.stringify(rawResult, null, 2)}`);

    // Schema-aware setup for structured output
    let structuredLlm: LanguageModel = null;
    let schemaDescription = "";

    logger.debug(
      `🔄 Structured output requested, schema: ${JSON.stringify(toJSONSchema(outputSchema), null, 2)}`
    );
    // Check if withStructuredOutput method exists
    if (
      llm &&
      "withStructuredOutput" in llm &&
      typeof (llm as any).withStructuredOutput === "function"
    ) {
      structuredLlm = (llm as any).withStructuredOutput(outputSchema);
    } else if (llm) {
      // Fallback: use the same LLM but we'll handle structure in our helper method
      structuredLlm = llm;
    } else {
      throw new Error("LLM is required for structured output");
    }
    const jsonSchema = toJSONSchema(outputSchema) as any;
    const { $schema, additionalProperties, ...cleanSchema } = jsonSchema;
    schemaDescription = JSON.stringify(cleanSchema, null, 2);
    logger.info(`🔄 Schema description: ${schemaDescription}`);

    // Handle different input formats - rawResult might be an array or object from the agent
    let textContent: string = "";
    if (typeof rawResult === "string") {
      textContent = rawResult;
    } else if (rawResult && typeof rawResult === "object") {
      // Handle object format
      textContent = JSON.stringify(rawResult);
    }

    logger.info("rawResult", rawResult);

    // If we couldn't extract text, use the stringified version
    if (!textContent) {
      textContent = JSON.stringify(rawResult);
    }

    // Get detailed schema information for better prompting
    const maxRetries = 3;
    let lastError: string = "";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.info(`🔄 Structured output attempt ${attempt}/${maxRetries}`);

      let formatPrompt = `
      Please format the following information according to the EXACT schema specified below.
      You must use the exact field names and types as shown in the schema.

      Required schema format:
      ${schemaDescription}

      Content to extract from:
      ${textContent}

      IMPORTANT:
      - Use ONLY the field names specified in the schema
      - Match the data types exactly (string, number, boolean, array, etc.)
      - Include ALL required fields
      - Return valid JSON that matches the schema structure exactly
      - For missing data: use null for nullable fields, omit optional fields entirely
      - Do NOT use empty strings ("") or zero (0) as placeholders for missing data
      `;

      // Add specific error feedback for retry attempts
      if (attempt > 1) {
        formatPrompt += `

        PREVIOUS ATTEMPT FAILED with error: ${lastError}
        Please fix the issues mentioned above and ensure the output matches the schema exactly.
        `;
      }

      try {
        logger.info(
          `🔄 Structured output attempt ${attempt} - using streaming approach`
        );
        const contentPreview =
          textContent.length > 300
            ? `${textContent.slice(0, 300)}...`
            : textContent;
        logger.info(
          `🔄 Content being formatted (${textContent.length} chars): ${contentPreview}`
        );

        // Log the full prompt being sent to LLM
        logger.info(
          `🔄 Full format prompt (${formatPrompt.length} chars):\n${formatPrompt}`
        );

        // Use streaming to avoid blocking the event loop
        const stream = await structuredLlm!.stream(formatPrompt);
        let structuredResult = null;
        let chunkCount = 0;

        for await (const chunk of stream) {
          chunkCount++;

          // Print the chunk for debugging
          logger.debug(
            `Chunk ${chunkCount}: ${JSON.stringify(chunk, null, 2)}`
          );

          // Handle different chunk types
          if (typeof chunk === "string") {
            // If it's a string, try to parse it as JSON
            try {
              structuredResult = JSON.parse(chunk);
            } catch (e) {
              logger.warn(`🔄 Failed to parse string chunk as JSON: ${chunk}`);
            }
          } else if (chunk && typeof chunk === "object") {
            // If it's already an object, use it directly
            structuredResult = chunk;
          } else {
            // Convert other types to string and try to parse
            try {
              structuredResult = JSON.parse(String(chunk));
            } catch (e) {
              logger.warn(`🔄 Failed to parse chunk as JSON: ${chunk}`);
            }
          }

          if (chunkCount % 10 === 0) {
            logger.debug(
              `🔄 Structured output streaming: ${chunkCount} chunks`
            );
          }
        }

        logger.info(
          `🔄 Structured result attempt ${attempt}: ${JSON.stringify(structuredResult, null, 2)}`
        );

        // Use the structured result directly (no need to parse)
        if (!structuredResult) {
          throw new Error("No structured result received from stream");
        }

        // Validate the structured result
        const validatedResult = this._validateStructuredResult(
          structuredResult,
          outputSchema
        );
        logger.info(`✅ Structured output successful on attempt ${attempt}`);
        return validatedResult;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        logger.warn(
          `⚠️ Structured output attempt ${attempt} failed: ${lastError}`
        );

        if (attempt === maxRetries) {
          logger.error(
            `❌ All ${maxRetries} structured output attempts failed`
          );
          throw new Error(
            `Failed to generate valid structured output after ${maxRetries} attempts. Last error: ${lastError}`
          );
        }

        // Continue to next attempt
        continue;
      }
    }

    // This should never be reached, but TypeScript requires it
    throw new Error("Unexpected error in structured output generation");
  }

  /**
   * Validate the structured result against the schema with detailed error reporting
   */
  private _validateStructuredResult<T>(
    structuredResult: any,
    outputSchema: ZodSchema<T>
  ): T {
    // Use Zod to validate the structured result
    try {
      // Use Zod to validate the structured result
      const validatedResult = outputSchema.parse(structuredResult);

      // Additional validation for required fields
      const schemaType = outputSchema as any;
      if (schemaType._def && schemaType._def.shape) {
        for (const [fieldName, fieldSchema] of Object.entries(
          schemaType._def.shape
        )) {
          const field = fieldSchema as any;
          const isOptional =
            field.isOptional?.() ?? field._def?.typeName === "ZodOptional";
          const isNullable =
            field.isNullable?.() ?? field._def?.typeName === "ZodNullable";
          if (!isOptional && !isNullable) {
            const value = (validatedResult as any)[fieldName];
            if (
              value === null ||
              value === undefined ||
              (typeof value === "string" && !value.trim()) ||
              (Array.isArray(value) && value.length === 0)
            ) {
              throw new Error(
                `Required field '${fieldName}' is missing or empty`
              );
            }
          }
        }
      }

      return validatedResult;
    } catch (e) {
      logger.debug(`Validation details: ${e}`);
      throw e; // Re-raise to trigger retry logic
    }
  }

  /**
   * Enhance the query with schema information to make the agent aware of required fields.
   */
  private _enhanceQueryWithSchema<T>(
    query: string,
    outputSchema: ZodSchema<T>
  ): string {
    try {
      const jsonSchema = toJSONSchema(outputSchema) as any;
      const { $schema, additionalProperties, ...cleanSchema } = jsonSchema;
      const schemaDescription = JSON.stringify(cleanSchema, null, 2);

      // Enhance the query with schema awareness
      const enhancedQuery = `
      ${query}

      IMPORTANT: Your response must include sufficient information to populate the following structured output:

      ${schemaDescription}

      Make sure you gather ALL the required information during your task execution.
      If any required information is missing, continue working to find it.
      `;

      return enhancedQuery;
    } catch (e) {
      logger.warn(`Could not extract schema details: ${e}`);
      return query;
    }
  }
}
