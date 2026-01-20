/**
 * Entry point for the React integration.
 * Provides the useMcp hook and related types.
 */

export type { UseMcpOptions, UseMcpResult } from "./types.js";
export { useMcp } from "./useMcp.js";

// Re-export auth callback handler for OAuth flow
export { onMcpAuthorization } from "../auth/callback.js";

// Re-export browser telemetry (browser-specific implementation)
export {
  Tel,
  Telemetry,
  setTelemetrySource,
} from "../telemetry/telemetry-browser.js";

// Backwards compatibility aliases
export { Tel as BrowserTelemetry } from "../telemetry/telemetry-browser.js";
export { setTelemetrySource as setBrowserTelemetrySource } from "../telemetry/telemetry-browser.js";

// Re-export core types for convenience when using hook result
export type {
  Prompt,
  Resource,
  ResourceTemplate,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Export OpenAI Apps SDK widget hooks and types
export { ErrorBoundary } from "./ErrorBoundary.js";
export { Image } from "./Image.js";
export { ThemeProvider } from "./ThemeProvider.js";
export {
  useWidget,
  useWidgetProps,
  useWidgetState,
  useWidgetTheme,
} from "./useWidget.js";
export type {
  API,
  CallToolResponse,
  DeviceType,
  DisplayMode,
  OpenAiGlobals,
  SafeArea,
  SafeAreaInsets,
  Theme,
  UnknownObject,
  UserAgent,
  UseWidgetResult,
} from "./widget-types.js";
export { WidgetControls } from "./WidgetControls.js";
export { McpUseProvider } from "./McpUseProvider.js";

// Export multi-server client provider and hooks
export {
  McpClientProvider,
  useMcpClient,
  useMcpServer,
} from "./McpClientProvider.js";
export type {
  McpServer,
  McpServerOptions,
  McpClientContextType,
  McpClientProviderProps,
  McpNotification,
  PendingSamplingRequest,
  PendingElicitationRequest,
} from "./McpClientProvider.js";

// Export storage providers
export {
  LocalStorageProvider,
  MemoryStorageProvider,
  type CachedServerMetadata,
  type StorageProvider,
} from "./storage/index.js";

// Export RPC logger utilities
export {
  getRpcLogs,
  getAllRpcLogs,
  subscribeToRpcLogs,
  clearRpcLogs,
  type RpcLogEntry,
} from "./rpc-logger.js";

// Export WidgetMetadata type for widget developers
export type { WidgetMetadata } from "../server/types/widget.js";
