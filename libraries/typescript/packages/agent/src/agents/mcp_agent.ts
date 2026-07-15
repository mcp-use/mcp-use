import type { MCPClient } from "@mcp-use/client";
import type { BaseConnector } from "@mcp-use/client";
import { logger } from "@mcp-use/client";
import type { ZodSchema } from "zod";
import { NativeAdapter } from "../adapters/native_adapter.js";
import { RestLlmDriver, type LlmDriver } from "../llm/driver.js";
import {
  streamNativeAgent,
  streamNativeAgentSteps,
  runNativeAgent,
} from "../llm/native_runner.js";
import {
  parseLLMStringToProviderConfig,
  providerConfigFromOptions,
  type NativeLLMConfig,
} from "../llm/provider_config.js";
import type {
  LlmStreamEvent,
  ProviderConfig,
  ProviderMessage,
  ProviderName,
} from "../llm/types.js";
import { getPackageVersion } from "../version.js";
import type { MCPAgentOptions, McpConnectionLike, McpServersInput } from "./agent_options.js";
import { normalizeRunOptions } from "./normalize_run_options.js";
import type { RunOptions } from "./run_options.js";
import { RemoteAgent } from "./remote.js";
import type { MCPServerConfig } from "./types.js";

export type { ProviderName, ProviderConfig, ProviderMessage, LlmStreamEvent };
export type { MCPAgentOptions, McpConnectionLike, McpServersInput } from "./agent_options.js";
export type { RunOptions } from "./run_options.js";

export interface AgentStep {
  action: { tool: string; toolInput: Record<string, unknown>; log: string };
  observation: string;
}

type ResolvedRunOptions = {
  prompt?: string;
  maxSteps?: number;
  manageConnector?: boolean;
  messages?: ProviderMessage[];
  schema?: ZodSchema<unknown>;
  signal?: AbortSignal;
};

/**
 * Cross-platform MCP agent: Inspector → MCPAgent → loop → fetch + @mcp-use/client.
 */
export class MCPAgent {
  public static getPackageVersion(): string {
    return getPackageVersion();
  }

  private driver?: LlmDriver;
  private client?: MCPClient;
  private connectors: BaseConnector[] = [];
  private clientOwnedByAgent = false;
  private nativeAdapter: NativeAdapter;
  private providerTools: import("../llm/types.js").ProviderTool[] = [];
  private callTool?: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<unknown>;
  private maxSteps: number;
  private autoInitialize: boolean;
  private systemPrompt: string;
  private disallowedTools: string[];
  private exposeResourcesAsTools: boolean;
  private exposePromptsAsTools: boolean;
  private initialized = false;
  private isRemote = false;
  private remoteAgent: RemoteAgent | null = null;
  private isSimplifiedMode = false;
  private llmString?: string;
  private llmConfig?: NativeLLMConfig;
  private mcpServersConfig?: Record<string, MCPServerConfig>;
  private explicitProviderConfig?: ProviderConfig;
  private conversationMessages: ProviderMessage[] = [];
  private memoryEnabled: boolean;
  private boundConnections?: McpConnectionLike[];

  constructor(options: MCPAgentOptions) {
    if (options.agentId) {
      this.isRemote = true;
      this.remoteAgent = new RemoteAgent({
        agentId: options.agentId,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
      });
      this.maxSteps = options.maxSteps ?? 10;
      this.autoInitialize = options.autoInitialize ?? false;
      this.nativeAdapter = new NativeAdapter();
      this.systemPrompt =
        options.systemPrompt ??
        "You are a helpful assistant with access to MCP tools.";
      this.disallowedTools = [];
      this.exposeResourcesAsTools = true;
      this.exposePromptsAsTools = true;
      this.memoryEnabled = options.memoryEnabled ?? true;
      return;
    }

    this.maxSteps = options.maxSteps ?? 10;
    this.autoInitialize = options.autoInitialize ?? false;
    this.systemPrompt =
      options.systemPrompt ??
      "You are a helpful assistant with access to MCP tools.";
    this.disallowedTools = options.disallowedTools ?? [];
    this.exposeResourcesAsTools = options.exposeResourcesAsTools ?? true;
    this.exposePromptsAsTools = options.exposePromptsAsTools ?? true;
    this.memoryEnabled = options.memoryEnabled ?? true;
    this.nativeAdapter = new NativeAdapter(this.disallowedTools);
    this.llmConfig = options.llmConfig;
    this.resolveMcpServers(options.mcpServers);

    if (typeof options.llm === "string") {
      this.isSimplifiedMode = true;
      this.llmString = options.llm;
      if (
        !this.hasLiveConnections() &&
        (!this.mcpServersConfig ||
          Object.keys(this.mcpServersConfig).length === 0) &&
        !options.client &&
        !(options.connectors?.length)
      ) {
        throw new Error(
          "Simplified mode requires mcpServers, or an existing client/connectors."
        );
      }
    } else {
      this.explicitProviderConfig = options.llm;
      this.client = options.client;
      this.connectors = options.connectors ?? [];
      if (
        !this.hasLiveConnections() &&
        !this.client &&
        this.connectors.length === 0 &&
        (!this.mcpServersConfig ||
          Object.keys(this.mcpServersConfig).length === 0)
      ) {
        throw new Error(
          "Explicit mode requires mcpServers, client, or connectors."
        );
      }
    }

    if (options.client) this.client = options.client;
    if (options.connectors?.length) this.connectors = options.connectors;

    if (this.hasLiveConnections() && this.explicitProviderConfig) {
      this.bindConnections(this.boundConnections!, this.explicitProviderConfig);
    } else if (this.hasLiveConnections() && this.llmString) {
      this.driver = new RestLlmDriver(
        parseLLMStringToProviderConfig(this.llmString, this.llmConfig)
      );
      this.bindConnections(
        this.boundConnections!,
        parseLLMStringToProviderConfig(this.llmString, this.llmConfig)
      );
    }
  }

  private resolveMcpServers(mcpServers?: McpServersInput): void {
    if (!mcpServers) return;
    if (Array.isArray(mcpServers)) {
      this.boundConnections = mcpServers;
      return;
    }
    this.mcpServersConfig = mcpServers;
  }

  private hasLiveConnections(): boolean {
    return (this.boundConnections?.length ?? 0) > 0;
  }

  async initialize(): Promise<void> {
    if (this.isRemote) {
      this.initialized = true;
      return;
    }
    if (this.initialized) return;

    if (this.isSimplifiedMode) {
      if (!this.client && this.mcpServersConfig) {
        const { MCPClient } = await import("@mcp-use/client");
        this.client = new MCPClient({ mcpServers: this.mcpServersConfig });
        this.clientOwnedByAgent = true;
      }
      if (this.llmString) {
        this.driver = new RestLlmDriver(
          parseLLMStringToProviderConfig(this.llmString, this.llmConfig)
        );
      }
    } else if (this.explicitProviderConfig) {
      this.driver = new RestLlmDriver(this.explicitProviderConfig);
    }

    if (!this.driver) {
      throw new Error("LLM driver not configured.");
    }

    if (!this.hasLiveConnections()) {
      await this.loadTools();
    }
    this.initialized = true;
    logger.debug("MCPAgent initialized");
  }

  private async loadTools(): Promise<void> {
    const entries: import("../adapters/native_adapter.js").NativeToolEntry[] =
      [];

    if (this.client) {
      if (
        !this.client.activeSessions ||
        Object.keys(this.client.activeSessions).length === 0
      ) {
        await this.client.createAllSessions();
      }
      const sessions = this.client.getAllActiveSessions();
      const connectors = Object.values(sessions).map((s) => s.connector);
      entries.push(
        ...(await this.nativeAdapter.createToolsFromConnectors(connectors))
      );
      if (this.exposeResourcesAsTools) {
        entries.push(
          ...(await this.nativeAdapter.createResourcesFromConnectors(connectors))
        );
      }
      if (this.exposePromptsAsTools) {
        entries.push(
          ...(await this.nativeAdapter.createPromptsFromConnectors(connectors))
        );
      }
    } else {
      for (const connector of this.connectors) {
        if (!connector.isClientConnected) await connector.connect();
      }
      entries.push(
        ...(await this.nativeAdapter.createToolsFromConnectors(this.connectors))
      );
      if (this.exposeResourcesAsTools) {
        entries.push(
          ...(await this.nativeAdapter.createResourcesFromConnectors(
            this.connectors
          ))
        );
      }
      if (this.exposePromptsAsTools) {
        entries.push(
          ...(await this.nativeAdapter.createPromptsFromConnectors(
            this.connectors
          ))
        );
      }
    }

    this.providerTools = this.nativeAdapter.toProviderTools(entries);
    this.callTool = this.nativeAdapter.createCallTool();
  }

  private bindConnections(
    connections: McpConnectionLike[],
    providerConfig: ProviderConfig
  ): void {
    const disallowed = new Set(this.disallowedTools);
    const usedNames = new Set<string>();
    const routes = new Map<
      string,
      { connection: McpConnectionLike; mcpName: string }
    >();

    const reserveName = (name: string): string => {
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
      let i = 2;
      while (usedNames.has(`${name}_${i}`)) i++;
      const fallback = `${name}_${i}`;
      usedNames.add(fallback);
      return fallback;
    };

    const providerTools: import("../llm/types.js").ProviderTool[] = [];

    for (const connection of connections) {
      for (const tool of connection.tools ?? []) {
        if (disallowed.has(tool.name)) continue;
        const name = reserveName(tool.name);
        routes.set(name, { connection, mcpName: tool.name });
        providerTools.push({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema ?? {
            type: "object",
            properties: {},
          },
        });
      }
    }

    this.providerTools = providerTools;
    this.callTool = async (name, args) => {
      const route = routes.get(name);
      if (!route) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return route.connection.callTool(route.mcpName, args);
    };
    this.driver = new RestLlmDriver(providerConfig);
    this.initialized = true;
  }

  private buildMessages(options: ResolvedRunOptions): ProviderMessage[] {
    const messages: ProviderMessage[] = [
      { role: "system", content: this.systemPrompt },
    ];
    if (this.memoryEnabled && this.conversationMessages.length > 0) {
      messages.push(...this.conversationMessages);
    }
    if (options.messages?.length) {
      messages.push(...options.messages);
    }
    if (options.prompt) {
      messages.push({ role: "user", content: options.prompt });
    }
    return messages;
  }

  getConversationHistory(): ProviderMessage[] {
    return [...this.conversationMessages];
  }

  clearConversationHistory(): void {
    this.conversationMessages = [];
  }

  setSystemMessage(message: string): void {
    this.systemPrompt = message;
  }

  private async ensureReady(manageConnector = true): Promise<void> {
    if (manageConnector && !this.initialized) {
      if (this.autoInitialize) {
        await this.initialize();
      } else {
        throw new Error("MCPAgent not initialized. Call initialize() first.");
      }
    }
    if (!this.driver || !this.callTool) {
      throw new Error("MCPAgent driver or tools not ready.");
    }
  }

  private nativeRunParams(options: ResolvedRunOptions) {
    return {
      messages: this.buildMessages(options),
      tools: this.providerTools,
      callTool: this.callTool!,
      maxSteps: options.maxSteps ?? this.maxSteps,
      signal: options.signal,
    };
  }

  public async run(options: RunOptions): Promise<string>;
  public async run<T>(options: RunOptions<T>): Promise<T>;
  /** @deprecated Use run({ prompt, maxSteps, ... }) */
  public async run(
    query: string,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: unknown,
    outputSchema?: undefined,
    signal?: AbortSignal
  ): Promise<string>;
  /** @deprecated Use run({ prompt, schema, maxSteps, ... }) */
  public async run<T>(
    query: string,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: unknown,
    outputSchema?: ZodSchema<T>,
    signal?: AbortSignal
  ): Promise<T>;
  public async run<T>(
    queryOrOptions: string | RunOptions<T>,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: unknown,
    outputSchema?: ZodSchema<T>,
    signal?: AbortSignal
  ): Promise<string | T> {
    const options = normalizeRunOptions(
      queryOrOptions,
      maxSteps,
      manageConnector,
      externalHistory,
      outputSchema,
      signal
    );
    if (options.schema) {
      throw new Error(
        "Structured output requires @mcp-use/agent/langchain or pass a JSON schema via prompt."
      );
    }
    if (this.isRemote && this.remoteAgent) {
      return this.remoteAgent.run(
        options.prompt ?? "",
        options.maxSteps,
        options.manageConnector
      ) as Promise<string | T>;
    }
    await this.ensureReady(options.manageConnector ?? true);
    const result = await runNativeAgent(
      this.driver!,
      this.nativeRunParams(options)
    );
    if (this.memoryEnabled && options.prompt) {
      this.conversationMessages.push({
        role: "user",
        content: options.prompt,
      });
      this.conversationMessages.push({
        role: "assistant",
        content: result,
      });
    }
    return result;
  }

  public stream(options: RunOptions): AsyncGenerator<AgentStep, string, void>;
  public stream<T>(
    options: RunOptions<T>
  ): AsyncGenerator<AgentStep, T, void>;
  /** @deprecated Use stream({ prompt, maxSteps, ... }) */
  public stream<T = string>(
    query: string,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: unknown,
    outputSchema?: ZodSchema<T>,
    signal?: AbortSignal
  ): AsyncGenerator<AgentStep, string | T, void>;
  public async *stream<T = string>(
    queryOrOptions: string | RunOptions<T>,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: unknown,
    outputSchema?: ZodSchema<T>,
    signal?: AbortSignal
  ): AsyncGenerator<AgentStep, string | T, void> {
    const options = normalizeRunOptions(
      queryOrOptions,
      maxSteps,
      manageConnector,
      externalHistory,
      outputSchema,
      signal
    );
    if (this.isRemote && this.remoteAgent) {
      const result = await this.remoteAgent.run(
        options.prompt ?? "",
        options.maxSteps,
        options.manageConnector
      );
      return result as string | T;
    }
    await this.ensureReady(options.manageConnector ?? true);
    const result = yield* streamNativeAgentSteps(
      this.driver!,
      this.nativeRunParams(options)
    );
    if (this.memoryEnabled && options.prompt) {
      this.conversationMessages.push({
        role: "user",
        content: options.prompt,
      });
      this.conversationMessages.push({
        role: "assistant",
        content: result,
      });
    }
    return result;
  }

  public streamEvents(
    options: RunOptions
  ): AsyncGenerator<LlmStreamEvent, void, unknown>;
  public streamEvents<T>(
    options: RunOptions<T>
  ): AsyncGenerator<LlmStreamEvent, void, unknown>;
  /** @deprecated Use streamEvents({ prompt, maxSteps, ... }) */
  public streamEvents<T = string>(
    query: string,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: unknown,
    outputSchema?: ZodSchema<T>,
    signal?: AbortSignal
  ): AsyncGenerator<LlmStreamEvent, void, unknown>;
  public async *streamEvents<T = string>(
    queryOrOptions: string | RunOptions<T>,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: unknown,
    outputSchema?: ZodSchema<T>,
    signal?: AbortSignal
  ): AsyncGenerator<LlmStreamEvent, void, unknown> {
    const options = normalizeRunOptions(
      queryOrOptions,
      maxSteps,
      manageConnector,
      externalHistory,
      outputSchema,
      signal
    );
    if (this.isRemote && this.remoteAgent) {
      throw new Error("streamEvents is not supported for remote agents.");
    }
    await this.ensureReady(options.manageConnector ?? true);
    yield* streamNativeAgent(this.driver!, this.nativeRunParams(options));
  }

  /** Single-shot completion without tools (sampling, props generation). */
  async chat(options: {
    messages: ProviderMessage[];
    signal?: AbortSignal;
  }): Promise<string> {
    await this.ensureReady();
    const result = await this.driver!.complete({
      messages: options.messages,
      tools: [],
      signal: options.signal,
    });
    return result.text;
  }

  async close(): Promise<void> {
    if (this.clientOwnedByAgent && this.client) {
      await this.client.closeAllSessions?.();
    }
    this.initialized = false;
  }
}

/** Inspector / config UI LLM shape. */
export interface LLMConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;
  temperature?: number;
  baseUrl?: string;
}

export { providerConfigFromOptions, parseLLMStringToProviderConfig };
export { DEFAULT_OLLAMA_BASE_URL } from "../llm/providers/ollama/utils.js";
export { convertMessagesToProvider } from "../llm/messageFormat.js";
