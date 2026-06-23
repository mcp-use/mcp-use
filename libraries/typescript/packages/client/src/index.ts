/**
 * Main exports for @mcp-use/client
 */

export { MCPClient } from "./client.js";
export {
  MCPSession,
  type CallToolResult,
  type Notification,
  type Root,
  type Tool,
} from "./session.js";

// Connectors
export { BaseConnector, type NotificationHandler } from "./connectors/base.js";
export { HttpConnector } from "./connectors/http.js";
export { StdioConnector } from "./connectors/stdio.js";

// Config
export { loadConfigFile } from "./config-file.js";
export type {
  OnElicitationCallback,
  OnNotificationCallback,
  OnSamplingCallback,
  CallbackConfig,
} from "./config.js";

// Elicitation Helpers
export {
  accept,
  acceptWithDefaults,
  applyDefaults,
  cancel,
  decline,
  getDefaults,
  reject,
  validate,
  type ElicitContent,
  type ElicitValidationResult,
} from "./client/elicitation-helpers.js";

// Code execution types and classes
export type {
  CodeModeConfig,
  E2BExecutorOptions,
  ExecutorOptions,
  MCPClientOptions,
  VMExecutorOptions,
} from "./client.js";

export {
  BaseCodeExecutor,
  E2BCodeExecutor,
  isVMAvailable,
  VMCodeExecutor,
} from "./client.js";

export type {
  ExecutionResult,
  SearchToolsFunction,
  ToolNamespaceInfo,
  ToolSearchResult,
} from "./client/codeExecutor.js";

// Auth
export * from "./auth/index.js";
export type { StoredState } from "./auth/types.js";

// Telemetry
export { Telemetry, Tel, setTelemetrySource } from "./telemetry/telemetry-node.js";
export { telFetch } from "./telemetry/tel-fetch.js";
export { extractModelInfo } from "./telemetry/utils.js";

// Prompts / Code Mode
export { CODE_MODE_AGENT_PROMPT } from "./client/connectors/codeMode.js";
