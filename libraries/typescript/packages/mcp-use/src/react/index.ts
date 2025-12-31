/**
 * Entry point for the React integration.
 * Provides the useMcp hook and related types.
 */

export type { UseMcpOptions, UseMcpResult } from "./types.js";
export { useMcp } from "./useMcp.js";

// Re-export auth callback handler for OAuth flow
export { onMcpAuthorization } from "../auth/callback.js";

import { Tel } from "../telemetry/index.js";
import { BrowserTelemetryProvider } from "../telemetry/browser-provider.js";

// Initialize telemetry with Browser provider
if (typeof window !== "undefined") {
  try {
    Tel.getInstance().use(new BrowserTelemetryProvider());
  } catch (e) {
    // Ignore initialization errors
  }
}

// Re-export unified telemetry (now safe for browser)
export { Tel, Telemetry, setTelemetrySource } from "../telemetry/index.js";

// Backwards compatibility aliases
export { Tel as BrowserTelemetry } from "../telemetry/index.js";
export { setTelemetrySource as setBrowserTelemetrySource } from "../telemetry/index.js";

// Re-export core types for convenience when using hook result
export type {
  Prompt,
  Resource,
  ResourceTemplate,
  Tool,
} from "@mcp-use/modelcontextprotocol-sdk/types.js";

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

// Export WidgetMetadata type for widget developers
export type { WidgetMetadata } from "../server/types/widget.js";
