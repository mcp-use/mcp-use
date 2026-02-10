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

// Widget renderers & detection
export { MCPAppsRenderer } from "./components/MCPAppsRenderer.js";
export { ToolResultRenderer } from "./components/chat/ToolResultRenderer.js";
export {
  detectWidgetProtocol,
  hasBothProtocols,
  type WidgetProtocol,
} from "./utils/widget-detection.js";

// Context providers
export { ThemeProvider } from "./context/ThemeContext.js";
export { WidgetDebugProvider } from "./context/WidgetDebugContext.js";

// ---------------------------------------------------------------------------
// Chat components – embeddable chat UI for MCP servers
// ---------------------------------------------------------------------------

// Main chat orchestrator (top-level entry point for embedding)
export { ChatTab, type ChatTabProps } from "./components/ChatTab.js";

// Chat sub-components (for consumers who want finer-grained control)
export { MessageList } from "./components/chat/MessageList.js";
export { ChatHeader } from "./components/chat/ChatHeader.js";
export { ChatInputArea } from "./components/chat/ChatInputArea.js";
export { ChatLandingForm } from "./components/chat/ChatLandingForm.js";
export { ConfigurationDialog } from "./components/chat/ConfigurationDialog.js";
export { ConfigureEmptyState } from "./components/chat/ConfigureEmptyState.js";

// Chat types
export type {
  Message,
  LLMConfig,
  AuthConfig,
  MessageAttachment,
  MCPServerConfig,
  MCPConfig,
} from "./components/chat/types.js";

// Chat hooks
export { useChatMessagesClientSide } from "./components/chat/useChatMessagesClientSide.js";
export { useChatMessages } from "./components/chat/useChatMessages.js";
export { useConfig } from "./components/chat/useConfig.js";

// MCP Prompts hook (used by ChatTab, useful standalone)
export { useMCPPrompts, type PromptResult } from "./hooks/useMCPPrompts.js";
