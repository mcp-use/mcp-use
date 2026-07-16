/**
 * React entry point for the MCP connection console.
 *
 * Provides the `useMcp` hook, the multi-server `McpClientProvider`, and the
 * supporting storage / logging utilities for connecting to MCP servers from a
 * React app. MCP Apps host rendering lives in {@link ViewRenderer}.
 */

export type {
  UseMcpOptions,
  UseMcpResult,
  ReconnectionOptions,
  McpServer,
  McpServerConfig,
  /** @deprecated Use McpServerConfig */
  McpServerOptions,
  PersistedMcpServerConfig,
  pickPersistedServerConfig,
  toPersistedServerConfig,
  McpNotification,
  PendingSamplingRequest,
  PendingElicitationRequest,
} from "./types.js";
export { useMcp } from "./useMcp.js";
export { detectFavicon } from "../utils/favicon.js";

// Re-export auth callback handler for the OAuth flow
export { onMcpAuthorization } from "../auth/callback.js";

// Re-export browser telemetry (browser-specific implementation)
export {
  Tel,
  Telemetry,
  setTelemetrySource,
} from "../telemetry/telemetry-browser.js";

// Re-export core types for convenience when using the hook result
export type {
  Prompt,
  Resource,
  ResourceTemplateType,
  Tool,
} from "@modelcontextprotocol/client";

// Multi-server client provider and hooks
export {
  McpClientProvider,
  useMcpClient,
  useMcpServer,
} from "./McpClientProvider.js";
export type {
  McpClientContextType,
  McpClientProviderProps,
} from "./McpClientProvider.js";

// Storage providers
export {
  LocalStorageProvider,
  MemoryStorageProvider,
  type CachedServerMetadata,
  type StorageProvider,
} from "./storage.js";

// RPC logger utilities
export {
  getRpcLogs,
  getAllRpcLogs,
  subscribeToRpcLogs,
  clearRpcLogs,
  type RpcLogEntry,
} from "./rpc-logger.js";

// MCP Apps host renderer
export {
  ViewRenderer,
  resolveViewResource,
  getViewResourceUri,
  isViewResource,
  isViewTool,
  parseCustomProps,
  buildViewSandboxBlobUrl,
  type ViewRendererProps,
  type ViewConnection,
  type ViewDisplayMode,
  type ViewCspMode,
  type ViewRendererSource,
  type ResolvedViewResource,
  type ViewCspViolation,
  type ViewLifecycleEvent,
  type ViewLifecycleStatus,
  type McpUiHostCapabilities,
  type McpUiHostContext,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from "./view/ViewRenderer.js";
