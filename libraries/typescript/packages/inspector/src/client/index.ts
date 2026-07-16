/**
 * Client-side exports for inspector package
 *
 * CSS note: Chat components use Tailwind CSS utility classes.
 * Consumers must have Tailwind CSS configured and include this package
 * in their content paths:
 *   content: ["./node_modules/@mcp-use/inspector/dist/client/**"]
 */

export { AddToClientDropdown } from "./components/AddToClientDropdown.js";
export * from "./utils/mcpClientUtils.js";

// Tool execution components
export { ToolInputForm } from "./components/tools/ToolInputForm.js";
export {
  ToolResultDisplay,
  type ToolResult,
} from "./components/tools/ToolResultDisplay.js";

// Chat tool result rendering (MCP Apps views)
export { ToolResultRenderer } from "./components/chat/ToolResultRenderer.js";
export {
  ViewRenderer,
  isViewTool,
  getViewResourceUri,
} from "@mcp-use/client/react";

// Context providers
export { ThemeProvider } from "./context/ThemeContext.js";
export { WidgetDebugProvider } from "./context/WidgetDebugContext.js";
export {
  InspectorProvider,
  useInspector,
  type EmbeddedConfig,
  type TabType,
} from "./context/InspectorContext.js";

// ---------------------------------------------------------------------------
// Tab components – full inspector tabs for embedding
// ---------------------------------------------------------------------------
export { ToolsTab, type ToolsTabRef } from "./components/ToolsTab.js";
export {
  ResourcesTab,
  type ResourcesTabRef,
} from "./components/ResourcesTab.js";
export { PromptsTab, type PromptsTabRef } from "./components/PromptsTab.js";

// ---------------------------------------------------------------------------
// Chat components – embeddable chat UI for MCP servers
// ---------------------------------------------------------------------------

// Main chat orchestrator (top-level entry point for embedding)
export { ChatTab, type ChatTabProps } from "./components/ChatTab.js";

// Chat sub-components (for consumers who want finer-grained control)
export { MessageList } from "./components/chat/MessageList.js";
export { ChatHeader } from "./components/chat/ChatHeader.js";
export {
  chatBarActionButtonClass,
  chatBarFrostedPill,
  chatBarTitleFrostedClass,
} from "./components/chat/chat-bar-styles.js";
export { ChatInputArea } from "./components/chat/ChatInputArea.js";
export { ChatLandingForm } from "./components/chat/ChatLandingForm.js";
export { ConfigurationDialog } from "./components/chat/ConfigurationDialog.js";
export { ConfigureEmptyState } from "./components/chat/ConfigureEmptyState.js";
export { DEFAULT_CHAT_SYSTEM_PROMPT } from "./components/chat/system-prompt-default.js";
export type { ChatSystemPromptProvider } from "./components/chat/system-prompt/types.js";
export {
  getSystemPromptStorageKey,
  readStoredSystemPrompt,
  resolveSystemPrompt,
  writeStoredSystemPrompt,
} from "./components/chat/system-prompt/local-storage.js";

// Chat types
export type {
  Message,
  LLMConfig,
  AuthConfig,
  MessageAttachment,
  MCPServerConfig,
  MCPConfig,
  StreamProtocol,
} from "./components/chat/types.js";
export type { ChatView } from "./components/chat/ChatTraceView.js";
export type {
  InspectorTokenUsage,
  InspectorTraceEvent,
  InspectorTraceSpan,
  InspectorTraceState,
} from "./components/chat/trace.js";

// Chat hooks
export { useChatMessagesClientSide } from "./components/chat/useChatMessagesClientSide.js";
export { useChatMessages } from "./components/chat/useChatMessages.js";
export { useConfig } from "./components/chat/useConfig.js";

// Chat history
export { ChatHistoryPanel } from "./chat-history/ChatHistoryPanel.js";
export { ChatHistoryHeader } from "./chat-history/ChatHistoryHeader.js";
export { ChatHistoryRail } from "./chat-history/ChatHistoryRail.js";
export { ChatList, type ChatSession } from "./chat-history/ChatList.js";
export { ChatTitleReveal } from "./chat-history/ChatTitleReveal.js";
export type {
  ChatStorageProvider,
  ListChatsParams,
} from "./chat-history/types.js";
export { LocalChatStorageProvider } from "./chat-history/providers/local-storage.js";
export { chatEventsToInspectorMessages } from "./chat-history/chat-events-to-inspector-messages.js";
export type { ChatEventRowForMessages } from "./chat-history/chat-events-to-inspector-messages.js";
export { useChatHistory } from "./chat-history/useChatHistory.js";
export {
  CHAT_TITLE_PLACEHOLDER,
  CHAT_TITLE_SIMPLE,
  firstUserMessageFromMessages,
  generateChatTitleWithLlm,
  isPlaceholderTitle,
} from "./chat-history/chat-title.js";
export { useChatTitleGeneration } from "./chat-history/useChatTitleGeneration.js";

// MCP Prompts hook (used by ChatTab, useful standalone)
export { useMCPPrompts, type PromptResult } from "./hooks/useMCPPrompts.js";
