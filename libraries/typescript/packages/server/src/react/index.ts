/**
 * React view runtime for MCP Apps (`@mcp-use/server/react`).
 *
 * Browser-only — built on the ext-apps guest `App` class.
 */

export { bootstrapView, type ViewModule } from "./bootstrap-view.js";
export { ErrorBoundary } from "./ErrorBoundary.js";
export { Image } from "./Image.js";
export { ModelContext, modelContext } from "./model-context.js";
export { McpUseProvider } from "./McpUseProvider.js";
export { ThemeProvider } from "./ThemeProvider.js";
export { ViewControls } from "./ViewControls.js";
export { useCallTool, type CallToolHandle } from "./use-call-tool.js";
export { useView, useViewTheme, type ViewHandle } from "./use-view.js";
export { useViewProps } from "./use-view-props.js";
export { useViewState } from "./use-view-state.js";
export { useViewTool, type ViewToolDefinition } from "./use-view-tool.js";
export {
  type DeepPartial,
  type LoadingProps,
  type Register,
  type RegisteredTools,
  type UiPermissions,
  type ViewMetadata,
  type ViewProps,
} from "./register.js";
export type {
  HostCapabilities,
  HostContext,
  HostInfo,
  SafeAreaInsets,
} from "./host-types.js";
