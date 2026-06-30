/**
 * Entry point for the MCP-UI view runtime.
 *
 * Provides the widget hooks (useWidget, useCallTool, useFiles), the view
 * providers, and the generated type helpers used inside a rendered view. The
 * `useMcp` connection console and its supporting hooks live in the client
 * package at `@mcp-use/client/react`.
 */

// Re-export core MCP types for convenience inside views
export type {
  Prompt,
  Resource,
  ResourceTemplate,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// ModelContext component and module-level API
export { ModelContext, modelContext } from "./model-context.js";

// Widget hooks and types
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
  UseWidgetResult,
} from "./widget-types.js";
export { WidgetControls } from "./WidgetControls.js";
export { McpUseProvider } from "./McpUseProvider.js";

// useFiles hook
export { useFiles } from "./useFiles.js";
export type { UseFilesResult, UploadOptions } from "./useFiles.js";

// useCallTool hook and related types
export { useCallTool } from "./useCallTool.js";
export type {
  CallToolState,
  SideEffects,
  CallToolFn,
  CallToolAsyncFn,
  UseCallToolReturn,
} from "./useCallTool.js";

// generateHelpers factory and related types
export { generateHelpers } from "./generateHelpers.js";
export type {
  ToolMap,
  ToolInput,
  ToolOutput,
  TypedUseCallTool,
  TypedUseToolInfo,
  InferToolMapFromSchemas,
} from "./generateHelpers.js";

// WidgetMetadata type for widget developers
export type { WidgetMetadata } from "../server/types/widget.js";
