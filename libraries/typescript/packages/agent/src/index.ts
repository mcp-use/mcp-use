/**
 * `@mcp-use/agent` — Native cross-platform MCP agent.
 *
 * Inspector → MCPAgent → loop → raw fetch + `@mcp-use/client`.
 * LangChain integration lives in `@mcp-use/agent/langchain`.
 */

export {
  MCPAgent,
  convertMessagesToProvider,
  parseLLMStringToProviderConfig,
  providerConfigFromOptions,
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
export type { BaseMessage, MCPServerConfig } from "./agents/types.js";
export type { AgentAction } from "./agents/mcp_agent.js";
export type { NativeLLMConfig } from "./llm/provider_config.js";
export type {
  ContentPart,
  ImageContentPart,
  LlmDoneEvent,
  LlmErrorEvent,
  LlmTextDeltaEvent,
  LlmToolCallArgsDeltaEvent,
  LlmToolCallReadyEvent,
  LlmToolCallStartEvent,
  LlmToolResultEvent,
  LlmUsageEvent,
  ProviderTool,
  ProviderToolCall,
  TextContentPart,
} from "./llm/types.js";
export { LlmRequestError } from "./llm/providers/openai-chat-completions.js";
export { completeChat, completeChat as chat } from "./llm/chat.js";
export type {
  InspectorAttachment,
  InspectorMessageLike,
  InspectorMessagePart,
} from "./llm/messageFormat.js";
export {
  buildOllamaApiUrl,
  DEFAULT_OLLAMA_BASE_URL,
  normalizeOllamaBaseUrl,
  OllamaCorsError,
} from "./llm/providers/ollama/utils.js";
export { RemoteAgent, type RemoteAgentOptions } from "./agents/remote.js";
export { PROMPTS } from "./agents/prompts/index.js";
export {
  BaseAdapter,
  NativeAdapter,
  type NativeCallToolFn,
  type NativeToolEntry,
} from "./adapters/index.js";
