import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type {
  AIMessage,
  HumanMessage,
  ToolMessage,
  SystemMessage,
} from "langchain";
import type { LangChainAdapter } from "../adapters/langchain_adapter.js";
import type { MCPClient } from "@mcp-use/client";
import type { BaseConnector } from "@mcp-use/client";
import type { ServerManager } from "../managers/server_manager.js";
import type { LLMConfig } from "./utils/llm_provider.js";

/** LangChain message types accepted as conversation history. */
export type BaseMessage =
  | AIMessage
  | HumanMessage
  | ToolMessage
  | SystemMessage;

/** A LangChain-compatible chat model accepted by the agent. */
export type LanguageModel = any;

/** MCP server transport configuration used in simplified mode. */
export interface MCPServerConfig {
  /** Executable for a stdio server. */
  command?: string;
  /** Arguments passed to the stdio executable. */
  args?: string[];
  /** Environment variables passed to the stdio process. */
  env?: Record<string, string>;
  /** URL for a remote MCP transport. */
  url?: string;
  /** HTTP headers sent to a remote MCP server. */
  headers?: Record<string, string>;
  /** Legacy snake-case authentication token. */
  auth_token?: string;
  /** Authentication token sent to a remote MCP server. */
  authToken?: string;
}

/** Options shared by explicit and simplified LangChain agents. */
export interface CommonAgentOptions {
  /** Maximum model calls per run. Defaults to `5`. */
  maxSteps?: number;
  /** Initializes the agent on its first run. Defaults to `false`. */
  autoInitialize?: boolean;
  /** Retains conversation history between runs. Defaults to `true`. */
  memoryEnabled?: boolean;
  /** Complete system instruction override. */
  systemPrompt?: string | null;
  /** Template used to build the system instruction from available tools. */
  systemPromptTemplate?: string | null;
  /** Instructions appended to the generated system message. */
  additionalInstructions?: string | null;
  /** MCP tool names to omit from the agent. */
  disallowedTools?: string[];
  /** Additional LangChain tools exposed alongside MCP tools. */
  additionalTools?: StructuredToolInterface[];
  /** Mutable array populated with tool names used during execution. */
  toolsUsedNames?: string[];
  /** Exposes MCP resources as tools. Defaults to `true`. */
  exposeResourcesAsTools?: boolean;
  /** Exposes MCP prompts as tools. Defaults to `true`. */
  exposePromptsAsTools?: boolean;
  /** Enables dynamic server-selection tools. */
  useServerManager?: boolean;
  /** Enables detailed execution logging. */
  verbose?: boolean;
  /** Enables observability callbacks. Defaults to `true`. */
  observe?: boolean;
  /** Adapter used to create LangChain tools. */
  adapter?: LangChainAdapter;
  /** Factory used to customize server management. */
  serverManagerFactory?: (client: MCPClient) => ServerManager;
  /** Custom LangChain observability callbacks. */
  callbacks?: BaseCallbackHandler[];
  /** Hosted agent identifier for remote execution. */
  agentId?: string;
  /** Remote API key. Defaults to `MCP_USE_API_KEY`. */
  apiKey?: string;
  /** Remote API origin. */
  baseUrl?: string;
}

/** Options for a pre-instantiated LangChain model and MCP client/connectors. */
export interface ExplicitModeOptions extends CommonAgentOptions {
  /** Pre-instantiated LangChain chat model. */
  llm: LanguageModel;
  /** Existing MCP client. */
  client?: MCPClient;
  /** Existing MCP connectors. */
  connectors?: BaseConnector[];
  /** Simplified server configurations are not accepted in explicit mode. */
  mcpServers?: never;
  /** Simplified model configuration is not accepted in explicit mode. */
  llmConfig?: never;
}

/** Options for an agent that creates its model and MCP client from config. */
export interface SimplifiedModeOptions extends CommonAgentOptions {
  /** Model identifier in `"provider/model"` format. */
  llm: string;
  /** Provider credentials and model constructor settings. */
  llmConfig?: LLMConfig;
  /** Named MCP server transport configurations. */
  mcpServers: Record<string, MCPServerConfig>;
  /** Existing clients are not accepted in simplified mode. */
  client?: never;
  /** Existing connectors are not accepted in simplified mode. */
  connectors?: never;
}

/** Constructor options for the LangChain MCP agent. */
export type MCPAgentOptions = ExplicitModeOptions | SimplifiedModeOptions;
