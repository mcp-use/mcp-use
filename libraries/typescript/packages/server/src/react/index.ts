/**
 * React view runtime for MCP Apps (`@mcp-use/server/react`).
 *
 * Browser-only — built on the ext-apps guest `App` class. Layout:
 * `types/` (the zero-codegen typing layer and vendored host types),
 * `bridge/` (the ext-apps `App` singleton, iframe bootstrap, and the
 * model-context store), `hooks/` (the user-facing hook surface), and
 * `components/` (provider/utility components).
 */

export { bootstrapView, type ViewModule } from "./bridge/bootstrap-view.js";
export { ErrorBoundary } from "./components/error-boundary.js";
export { Image } from "./components/image.js";
export { ModelContext, modelContext } from "./components/model-context.js";
export { McpUseProvider } from "./components/mcp-use-provider.js";
export { ThemeProvider } from "./components/theme-provider.js";
export { ViewControls } from "./components/view-controls.js";
export { useCallTool, type CallToolHandle } from "./hooks/use-call-tool.js";
export { useView, useViewTheme, type ViewHandle } from "./hooks/use-view.js";
export { useViewProps } from "./hooks/use-view-props.js";
export { useViewState } from "./hooks/use-view-state.js";
export { useViewTool, type ViewToolDefinition } from "./hooks/use-view-tool.js";
export {
  type DeepPartial,
  type LoadingProps,
  type Register,
  type RegisteredTools,
  type UiPermissions,
  type ViewMetadata,
  type ViewProps,
} from "./types/register.js";
export type {
  HostCapabilities,
  HostContext,
  HostInfo,
  SafeAreaInsets,
} from "./types/host-types.js";
