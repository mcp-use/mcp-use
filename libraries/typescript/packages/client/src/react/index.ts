/**
 * React entry point for the MCP connection console.
 *
 * Provides the `useMcp` hook, the multi-server `McpClientProvider`, and the
 * supporting storage / logging utilities for connecting to MCP servers from a
 * React app. The widget/view runtime (useWidget, useCallTool, ...) lives in the
 * server package at `mcp-use/react`.
 */

export type {
  UseMcpOptions,
  UseMcpResult,
  ReconnectionOptions,
} from "./types.js";
export { useMcp } from "./useMcp.js";

// Re-export auth callback handler for the OAuth flow
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

// Re-export core types for convenience when using the hook result
export type {
  Prompt,
  Resource,
  ResourceTemplate,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Multi-server client provider and hooks
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

// Storage providers
export {
  LocalStorageProvider,
  MemoryStorageProvider,
  type CachedServerMetadata,
  type StorageProvider,
} from "./storage/index.js";

// RPC logger utilities
export {
  getRpcLogs,
  getAllRpcLogs,
  subscribeToRpcLogs,
  clearRpcLogs,
  type RpcLogEntry,
} from "./rpc-logger.js";
