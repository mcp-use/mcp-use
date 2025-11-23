/**
 * Entry point for the React integration.
 * Provides the useMcp hook and related types.
 */

export type { UseMcpOptions, UseMcpResult } from "./types.js";
export { useMcp } from "./useMcp.js";

// Re-export auth callback handler for OAuth flow
export { onMcpAuthorization } from "../auth/callback.js";

// Re-export core types for convenience when using hook result
export type {
  Prompt, Resource,
  ResourceTemplate, Tool
} from "@modelcontextprotocol/sdk/types.js";

// Export OpenAI Apps SDK widget hooks and types
export { ErrorBoundary } from "./ErrorBoundary.js";
export { Image } from "./Image.js";
export { ThemeProvider } from "./ThemeProvider.js";
export {
  useWidget,
  useWidgetProps, useWidgetState, useWidgetTheme
} from "./useWidget.js";
export type {
  API, CallToolResponse, DeviceType, DisplayMode, OpenAiGlobals, SafeArea,
  SafeAreaInsets, Theme, UnknownObject, UserAgent, UseWidgetResult
} from "./widget-types.js";
export { WidgetDebugger } from "./WidgetDebugger.js";
export { WidgetFullscreenWrapper } from "./WidgetFullscreenWrapper.js";

