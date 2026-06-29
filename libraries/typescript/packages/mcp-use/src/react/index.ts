/**
 * Entry point for the React integration.
 * Provides the useMcp hook and related types.
 */

export type {
  UseMcpOptions,
  UseMcpResult,
  ReconnectionOptions,
} from "./types.js";
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
  ResourceTemplateType as ResourceTemplate,
  Tool,
} from "@modelcontextprotocol/client";

// Export ModelContext component and module-level API
export { ModelContext, modelContext } from "./model-context.js";

// Export view hooks and types (primary API)
export { ErrorBoundary } from "./ErrorBoundary.js";
export { Image } from "./Image.js";
export { ThemeProvider } from "./ThemeProvider.js";
export {
  useView,
  useViewProps,
  useViewState,
  useViewTheme,
  useWidget,
  useWidgetProps,
  useWidgetState,
  useWidgetTheme,
} from "./useView.js";
export type {
  API,
  CallToolResponse,
  FileMetadata,
  MessageContentBlock,
  DeviceType,
  DisplayMode,
  OpenAiGlobals,
  SafeArea,
  SafeAreaInsets,
  Theme,
  ToolRegistry,
  UnknownObject,
  UserAgent,
  UseViewResult,
  UseWidgetResult,
} from "./widget-types.js";
export { WidgetControls } from "./WidgetControls.js";
export { McpUseProvider } from "./McpUseProvider.js";

// Export useFiles hook
export { useFiles } from "./useFiles.js";
export type { UseFilesResult, UploadOptions } from "./useFiles.js";

// Export useCallTool hook and related types
export { useCallTool } from "./useCallTool.js";
export type {
  CallToolState,
  SideEffects,
  CallToolFn,
  CallToolAsyncFn,
  UseCallToolReturn,
} from "./useCallTool.js";

export { createTypedHooks } from "./createTypedHooks.js";

// Export generateHelpers factory and related types
export { generateHelpers } from "./generateHelpers.js";
export type {
  ToolMap,
  ToolInput,
  ToolOutput,
  TypedUseCallTool,
  TypedUseToolInfo,
  InferToolMapFromSchemas,
} from "./generateHelpers.js";

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

export type { ToolRef } from "../server/types/tool-ref.js";

export type { WidgetMetadata } from "../server/types/widget.js";

export { useStreamableProps } from "./useStreamableProps.js";

export { defineWidget } from "./widget-config.js";
export type {
  ComponentWidgetConfig,
  WidgetCSPConfig,
  WidgetComponent,
  WidgetPermissions,
} from "./widget-config.js";
