import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type {
  AIMessage,
  HumanMessage,
  ToolMessage,
  SystemMessage,
} from "langchain";
import type { LangChainAdapter } from "../adapters/langchain_adapter.js";
import type { MCPClient } from "../client.js";
import type { BaseConnector } from "../connectors/base.js";
import type { ServerManager } from "../managers/server_manager.js";
import type { LLMConfig } from "./utils/llm_provider.js";

export type BaseMessage =
  | AIMessage
  | HumanMessage
  | ToolMessage
  | SystemMessage;

/**
 * Language model type that accepts any LangChain chat model.
 * Any is used to avoid TypeScript structural typing issues with protected properties until langchain fixes the issue.
 */
export type LanguageModel = any;

/**
 * Configuration for MCP servers in simplified mode
 */
export interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  auth_token?: string;
  authToken?: string;
  transport?: "http" | "sse";
  preferSse?: boolean;
}

/**
 * Common options shared between both explicit and simplified modes
 */
interface CommonAgentOptions {
  maxSteps?: number;
  autoInitialize?: boolean;
  memoryEnabled?: boolean;
  systemPrompt?: string | null;
  systemPromptTemplate?: string | null;
  additionalInstructions?: string | null;
  disallowedTools?: string[];
  additionalTools?: StructuredToolInterface[];
  toolsUsedNames?: string[];
  useServerManager?: boolean;
  verbose?: boolean;
  observe?: boolean;
  adapter?: LangChainAdapter;
  serverManagerFactory?: (client: MCPClient) => ServerManager;
  callbacks?: BaseCallbackHandler[];
  // Remote agent parameters
  agentId?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Explicit mode: User provides pre-instantiated LLM and client/connectors
 * This is the traditional initialization pattern with full control
 */
export interface ExplicitModeOptions extends CommonAgentOptions {
  llm: LanguageModel;
  client?: MCPClient;
  connectors?: BaseConnector[];
  // Simplified mode options should not be present
  mcpServers?: never;
  llmConfig?: never;
}

/**
 * Simplified mode: User provides LLM string and mcpServers config
 * The agent handles client creation and LLM instantiation internally
 */
export interface SimplifiedModeOptions extends CommonAgentOptions {
  llm: string; // Format: "provider/model" (e.g., "openai/gpt-4")
  llmConfig?: LLMConfig;
  mcpServers: Record<string, MCPServerConfig>;
  // Explicit mode options should not be present
  client?: never;
  connectors?: never;
}

/**
 * MCPAgent constructor options - supports both explicit and simplified modes
 */
export type MCPAgentOptions = ExplicitModeOptions | SimplifiedModeOptions;
