/**
 * @mcp-use/agent — Native cross-platform MCP agent.
 *
 * Inspector → MCPAgent → loop → raw fetch + @mcp-use/client.
 * LangChain integration lives in @mcp-use/agent/langchain.
 */

export {
  MCPAgent,
  convertMessagesToProvider,
  parseLLMStringToProviderConfig,
  providerConfigFromOptions,
  DEFAULT_OLLAMA_BASE_URL,
  type MCPAgentOptions,
  type McpConnectionLike,
  type McpServersInput,
  type RunOptions,
  type AgentStep,
  type ProviderName,
  type ProviderConfig,
  type ProviderMessage,
  type LlmStreamEvent,
  type TokenUsage,
  type LLMConfig,
} from "./agents/mcp_agent.js";
export { completeChat, completeChat as chat } from "./llm/chat.js";
export {
  buildOllamaApiUrl,
  normalizeOllamaBaseUrl,
  OllamaCorsError,
} from "./llm/providers/ollama/utils.js";
export { RemoteAgent } from "./agents/remote.js";
export { PROMPTS } from "./agents/prompts/index.js";
export { BaseAdapter, NativeAdapter } from "./adapters/index.js";
