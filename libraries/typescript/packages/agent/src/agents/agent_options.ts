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
