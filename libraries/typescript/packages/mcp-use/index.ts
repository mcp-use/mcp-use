/**
 * Main package exports for MCP client and MCP agent functionality
 *
 * This file serves as the primary entry point for consuming MCP (Model Context Protocol)
 * functionality in client applications and agent implementations. It exports all necessary
 * classes, utilities, and types for building MCP-based applications.
 *
 * @important Server functionality is exported from ./src/server/index.js -
 * do NOT export server-related modules from this file.
 */

import { MCPAgent } from "./src/agents/mcp_agent.js";
import { RemoteAgent } from "./src/agents/remote.js";
import { MCPClient } from "@mcp-use/client";
import type {
  OnElicitationCallback,
  OnNotificationCallback,
  OnSamplingCallback,
} from "@mcp-use/client";
import { loadConfigFile } from "@mcp-use/client";
import type { NotificationHandler } from "@mcp-use/client";
import { BaseConnector } from "@mcp-use/client";
import { HttpConnector } from "@mcp-use/client";
import { StdioConnector } from "@mcp-use/client";

import type { CreateMessageRequest } from "@modelcontextprotocol/sdk/types.js";
import { Logger, logger } from "./src/logging.js";
import {
  MCPSession,
  type CallToolResult,
  type Notification,
  type Root,
  type Tool,
} from "@mcp-use/client";

export { BaseAdapter } from "./src/adapters/index.js";
// Export AI SDK utilities
export * from "./src/agents/utils/index.js";
export { ServerManager } from "./src/managers/server_manager.js";

export * from "./src/managers/tools/index.js";

// Export observability utilities
export {
  ObservabilityManager,
  type ObservabilityConfig,
} from "./src/observability/index.js";

// Export telemetry utilities
export {
  Tel,
  setTelemetrySource,
  Telemetry,
  telFetch,
} from "./src/telemetry/index.js";

// Export version information (global)
export { getPackageVersion, VERSION } from "./src/version.js";

// Export new SDK-integrated auth utilities (recommended for new projects)
export {
  BrowserOAuthClientProvider,
  onMcpAuthorization,
  probeAuthParams,
} from "./src/auth/index.js";
export type { ProbeAuthParamsResult } from "./src/auth/index.js";
export type { StoredState } from "./src/auth/types.js";

// Export React hooks
export * from "./src/react/index.js";

// Export client prompts
export { PROMPTS } from "./src/agents/index.js";

// !!! NEVER EXPORT @langchain/core types it causes OOM errors when building the package
// Note: Message classes (AIMessage, BaseMessage, etc.) are not re-exported to avoid
// forcing TypeScript to deeply analyze @langchain/core types.
// Import them directly from "@langchain/core/messages" if needed.
// Same for StreamEvent - import from "@langchain/core/tracers/log_stream"

export {
  BaseConnector,
  HttpConnector,
  loadConfigFile,
  Logger,
  logger,
  MCPAgent,
  MCPClient,
  MCPSession,
  RemoteAgent,
  StdioConnector,
};

// Export session-related types
export type { CallToolResult, Notification, Root, Tool };

// Export notification types for handling server notifications
export type { NotificationHandler };

// Export code execution types and classes
export type {
  CodeModeConfig,
  E2BExecutorOptions,
  ExecutorOptions,
  MCPClientOptions,
  VMExecutorOptions,
} from "@mcp-use/client";

export {
  BaseCodeExecutor,
  E2BCodeExecutor,
  isVMAvailable,
  VMCodeExecutor,
} from "@mcp-use/client";

export type {
  ExecutionResult,
  SearchToolsFunction,
  ToolNamespaceInfo,
  ToolSearchResult,
} from "@mcp-use/client";

// Export custom error types
export {
  ElicitationDeclinedError,
  ElicitationTimeoutError,
  ElicitationValidationError,
} from "./src/errors.js";

// Export sampling types for LLM sampling capabilities
export type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Type alias for the params property of CreateMessageRequest.
 * Convenience type for sampling callback functions.
 */
export type CreateMessageRequestParams = CreateMessageRequest["params"];

/** Callback types so handlers can be typed without importing MCP SDK types. */
export type {
  OnElicitationCallback,
  OnNotificationCallback,
  OnSamplingCallback,
};

// Elicitation helpers (defaults, validation, accept/decline/cancel)
export {
  accept,
  acceptWithDefaults,
  applyDefaults,
  cancel,
  decline,
  getDefaults,
  reject,
  validate,
} from "@mcp-use/client";
export type {
  ElicitContent,
  ElicitValidationResult,
} from "@mcp-use/client";
