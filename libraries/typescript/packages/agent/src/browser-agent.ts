/**
 * Browser agent entry — native MCPAgent (LangChain-free).
 */

export {
  MCPAgent,
  convertMessagesToProvider,
  providerConfigFromOptions,
  type MCPAgentOptions,
  type McpConnectionLike,
  type McpServersInput,
  type RunOptions,
  type ProviderName,
  type ProviderConfig,
  type ProviderMessage,
  type LlmStreamEvent,
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
export { completeChat, completeChat as chat } from "./llm/chat.js";
export type {
  InspectorAttachment,
  InspectorMessageLike,
  InspectorMessagePart,
} from "./llm/messageFormat.js";
export { DEFAULT_OLLAMA_BASE_URL } from "./llm/providers/ollama/utils.js";
export { RemoteAgent, type RemoteAgentOptions } from "./agents/remote.js";
export {
  BaseAdapter,
  NativeAdapter,
  type NativeCallToolFn,
  type NativeToolEntry,
} from "./adapters/index.js";
