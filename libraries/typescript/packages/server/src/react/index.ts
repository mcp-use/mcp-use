/**
 * Build MCP App views with React components and hooks.
 *
 * This browser-only entry point provides the view runtime, typed tool context,
 * host integration hooks, and reusable view components.
 *
 * @packageDocumentation
 */

export {
  bootstrapView,
  disposeView,
  type ViewModule,
} from "./runtime/bootstrap-view.js";
export { type ViewConfig } from "./runtime/view-config.js";
export { ErrorBoundary } from "./components/error-boundary.js";
export { Image } from "./components/image.js";
export { ModelContext } from "./components/model-context.js";
export { ThemeProvider } from "./components/theme-provider.js";
export { ViewControls } from "./components/view-controls.js";
export {
  useCallTool,
  useDynamicTool,
  type CallToolHandle,
} from "./hooks/use-call-tool.js";
export { useDisplayMode } from "./hooks/use-display-mode.js";
export { useFiles } from "./hooks/use-files.js";
export {
  useHostContext,
  type HostContextHandle,
} from "./hooks/use-host-context.js";
export { useOpenExternal } from "./hooks/use-open-external.js";
export { useSendFollowUp } from "./hooks/use-send-follow-up.js";
export { useSendSizeChanged } from "./hooks/use-send-size-changed.js";
export { useViewTheme } from "./hooks/use-view-theme.js";
export { useViewState } from "./hooks/use-view-state.js";
export {
  useToolContext,
  type ToolContextHandle,
} from "./hooks/use-tool-context.js";
export { useViewTool, type ViewToolDefinition } from "./hooks/use-view-tool.js";
export {
  type DeepPartial,
  type Register,
  type RegisteredTools,
} from "./types/register.js";

export type { FileMetadata, UseFilesResult } from "./types/file-types.js";
export type {
  DisplayMode,
  HostCapabilities,
  HostContext,
  HostInfo,
  SafeAreaInsets,
} from "./types/host-types.js";
export {
  ToolError,
  toolResultText,
  type CallToolResult,
  type CallToolSuccess,
  type ToolContextError,
} from "./types/result-types.js";
