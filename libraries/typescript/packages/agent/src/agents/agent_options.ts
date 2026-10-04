import type { MCPClient } from "@mcp-use/client";
import type { BaseConnector } from "@mcp-use/client";
import type { ProviderConfig } from "../llm/types.js";
import type { NativeLLMConfig } from "../llm/provider_config.js";
import type { MCPServerConfig } from "./types.js";

/**
 * A live MCP connection that the agent can use without creating an
 * an MCP client.
 *
 * This structural interface accepts connection objects returned by browser
 * MCP hooks as well as custom connection implementations.
 */
export interface McpConnectionLike {
  /** Tools already discovered on the connection. */
  tools?: Array<{
    /** Tool name sent to the MCP server. */
    name: string;
    /** Human-readable tool description supplied to the model. */
    description?: string;
    /** JSON Schema describing the tool arguments. */
    inputSchema?: Record<string, unknown>;
  }>;
  /**
   * Invokes a tool on the connection.
   *
   * @param name - MCP tool name.
   * @param args - Tool arguments.
   * @param options - Optional cancellation signal.
   * @returns The raw MCP tool result.
   */
  callTool: (
    name: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ) => Promise<unknown>;
}

/**
 * MCP servers available to an agent.
 *
 * Pass a named configuration map when the agent should create its own client,
 * or pass live connections in browser environments.
 */
export type McpServersInput =
  | Record<string, MCPServerConfig>
  | McpConnectionLike[];

/**
 * Configures pre-flight MCP tool pruning via `tool-prune` before sending tool
 * schemas to the language model.
 */
export interface ToolPruneOptions {
  /**
   * Number of top candidate tools to expose per run, or `"auto"` to select
   * candidates dynamically based on score drop-off. Defaults to `"auto"`.
   */
  topK?: number | "auto";
  /**
   * Scoring engine used to rank tools against the user query.
   *
   * Defaults to `"typesafe"` when `apiKey` or `TYPESAFE_API_KEY` is present,
   * and falls back to offline `"turboquant"` quantization otherwise.
   */
  engine?: "typesafe" | "turboquant";
  /** TypeSafe System One API key override. */
  apiKey?: string;
  /** TypeSafe System One endpoint URL override. */
  endpoint?: string;
  /** TypeSafe System One model identifier. Defaults to `"jev-latest"`. */
  model?: string;
  /** Minimum confidence threshold for tool selection. Defaults to `0.85`. */
  threshold?: number;
  /** Minimum number of tools retained in `"auto"` mode. Defaults to `1`. */
  minK?: number;
  /** Maximum number of tools retained in `"auto"` mode. Defaults to `5`. */
  maxK?: number;
  /** Minimum TurboQuant score floor in `"auto"` mode. Defaults to `0.12`. */
  minScore?: number;
  /** Minimum calibrated probability floor in `"auto"` mode. Defaults to `0.2`. */
  minProbability?: number;
}

/** Configures a local or remote {@link MCPAgent}. */
export interface MCPAgentOptions {
  /**
   * Model identifier such as `"openai/gpt-4o"`, or a complete
   * provider configuration.
   */
  llm: string | ProviderConfig;
  /** Credentials and sampling overrides for a string model identifier. */
  llmConfig?: NativeLLMConfig;
  /** Existing MCP client. The agent does not create another client. */
  client?: MCPClient;
  /** Existing MCP connectors to initialize and expose as tools. */
  connectors?: BaseConnector[];
  /** Named server configurations or live browser connections. */
  mcpServers?: McpServersInput;
  /** Maximum model/tool-loop steps per run. Defaults to `10`. */
  maxSteps?: number;
  /** Initializes the agent on the first run. Defaults to `false`. */
  autoInitialize?: boolean;
  /** Retains user and assistant messages between runs. Defaults to `true`. */
  memoryEnabled?: boolean;
  /**
   * System instruction for local runs. Pass `null` to use the default
   * instruction.
   */
  systemPrompt?: string | null;
  /** MCP tool names that must not be exposed to the model. */
  disallowedTools?: string[];
  /**
   * Prunes model-visible MCP tool schemas per query using `tool-prune` before
   * calling the LLM while keeping all registered tools callable.
   *
   * Pass `true` for default automatic pruning or a {@link ToolPruneOptions}
   * object to customize candidate count and engine settings. Defaults to `false`.
   */
  pruneTools?: boolean | ToolPruneOptions;
  /** Exposes MCP resources as callable tools. Defaults to `true`. */
  exposeResourcesAsTools?: boolean;
  /** Exposes MCP prompts as callable tools. Defaults to `true`. */
  exposePromptsAsTools?: boolean;
  /** Remote agent identifier. When set, execution uses the remote API. */
  agentId?: string;
  /** Remote API key. Defaults to `MCP_USE_API_KEY`. */
  apiKey?: string;
  /** Remote API origin. Defaults to `https://cloud.manufact.com`. */
  baseUrl?: string;
}
