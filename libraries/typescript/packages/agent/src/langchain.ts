/**
 * LangChain bridge for @mcp-use/agent.
 */

export { MCPAgent } from "./agents/mcp_agent_langchain.js";
/** @deprecated Import `MCPAgent` from `@mcp-use/agent/langchain` instead. */
export { MCPAgent as LangChainMCPAgent } from "./agents/mcp_agent_langchain.js";
export { PROMPTS } from "./agents/prompts/index.js";
export { LangChainAdapter } from "./adapters/langchain_adapter.js";
export { ServerManager } from "./managers/server_manager.js";
export * from "./managers/tools/index.js";
export * from "./agents/utils/index.js";
export {
  type ObservabilityConfig,
  ObservabilityManager,
} from "./observability/index.js";
export {
  createLLMFromString,
  parseLLMString,
  getSupportedProviders,
} from "./agents/utils/llm_provider.js";
