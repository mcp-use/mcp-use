/**
 * LangChain bridge for `@mcp-use/agent`.
 */

export { MCPAgent as LangChainMCPAgent } from "./agents/mcp_agent_langchain.js";
export type {
  AgentStep as LangChainAgentStep,
  LangChainAgentAction,
} from "./agents/mcp_agent_langchain.js";
export type {
  BaseMessage,
  CommonAgentOptions,
  ExplicitModeOptions,
  LanguageModel,
  MCPAgentOptions,
  MCPServerConfig,
  SimplifiedModeOptions,
} from "./agents/types.js";
export type { RunOptions } from "./agents/run_options.js";
export { LangChainAdapter } from "./adapters/langchain_adapter.js";
export { ServerManager } from "./managers/server_manager.js";
export type { IServerManager } from "./managers/types.js";
export * from "./managers/tools/index.js";
export * from "./agents/utils/index.js";
export {
  type ObservabilityConfig,
  ObservabilityManager,
  type ObservabilityStatus,
} from "./observability/index.js";
export {
  createLLMFromString,
  parseLLMString,
  getSupportedProviders,
} from "./agents/utils/llm_provider.js";
