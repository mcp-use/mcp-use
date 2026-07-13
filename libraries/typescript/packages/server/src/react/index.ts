/**
 * React view runtime for MCP Apps (`@mcp-use/server/react`).
 *
 * Browser-only — built on the ext-apps guest `App` class. Layout:
 * `types/` (the zero-codegen typing layer and vendored host types),
 * `runtime/` (per-document `McpAppRuntime`, snapshots, and iframe bootstrap),
 * `hooks/` (the user-facing hook surface), and `components/`
 * (provider/utility components).
 */

export {
  bootstrapView,
  disposeView,
  type ViewModule,
} from "./runtime/bootstrap-view.js";
export { type ViewConfig } from "./runtime/view-config.js";
export { ErrorBoundary } from "./components/error-boundary.js";
export { Image } from "./components/image.js";
export { ModelContext, modelContext } from "./components/model-context.js";
export { ThemeProvider } from "./components/theme-provider.js";
export { ViewControls } from "./components/view-controls.js";
export {
  useCallTool,
  type CallToolHandle,
} from "./hooks/use-call-tool.js";
export { useDisplayMode } from "./hooks/use-display-mode.js";
export {
  useHostContext,
  type HostContextHandle,
} from "./hooks/use-host-context.js";
export { useOpenExternal } from "./hooks/use-open-external.js";
export { useSendFollowUp } from "./hooks/use-send-follow-up.js";
export { useSendSizeChanged } from "./hooks/use-send-size-changed.js";
export { useViewTheme } from "./hooks/use-view-theme.js";
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
export type {
  DisplayMode,
  HostCapabilities,
  HostContext,
  HostInfo,
  SafeAreaInsets,
} from "./types/host-types.js";
export {
  InvalidToolResultError,
  type CallToolData,
  type CallToolResult,
  type ToolContextError,
} from "./types/result-types.js";
