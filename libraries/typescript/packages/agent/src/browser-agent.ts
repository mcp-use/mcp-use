/**
 * Browser agent entry — native MCPAgent (LangChain-free).
 */

export {
  MCPAgent,
  convertMessagesToProvider,
  providerConfigFromOptions,
  DEFAULT_OLLAMA_BASE_URL,
  type MCPAgentOptions,
  type McpConnectionLike,
  type McpServersInput,
  type RunOptions,
  type ProviderName,
  type ProviderConfig,
  type ProviderMessage,
  type LlmStreamEvent,
} from "./agents/mcp_agent.js";
export { completeChat, completeChat as chat } from "./llm/chat.js";
export { RemoteAgent } from "./agents/remote.js";
export { BaseAdapter, NativeAdapter } from "./adapters/index.js";
