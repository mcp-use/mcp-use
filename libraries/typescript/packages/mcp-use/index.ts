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
import { MCPClient } from "./src/client.js";
import { loadConfigFile } from "./src/config.js";
import { BaseConnector } from "./src/connectors/base.js";
import { HttpConnector } from "./src/connectors/http.js";
import { StdioConnector } from "./src/connectors/stdio.js";
import { WebSocketConnector } from "./src/connectors/websocket.js";

import { Logger, logger } from "./src/logging.js";
import { MCPSession } from "./src/session.js";

export { BaseAdapter, LangChainAdapter } from "./src/adapters/index.js";
// Export AI SDK utilities
export * from "./src/agents/utils/index.js";
export { ServerManager } from "./src/managers/server_manager.js";

export * from "./src/managers/tools/index.js";

// Export observability utilities
export {
  type ObservabilityConfig,
  ObservabilityManager,
} from "./src/observability/index.js";

// Export telemetry utilities
export { setTelemetrySource, Telemetry } from "./src/telemetry/index.js";

// Export OAuth helper (legacy - for backward compatibility)
export {
  OAuthHelper,
  LINEAR_OAUTH_CONFIG,
  createOAuthMCPConfig,
} from "./src/oauth-helper.js";
export type {
  OAuthConfig,
  OAuthDiscovery,
  ClientRegistration,
  OAuthResult,
  OAuthState,
} from "./src/oauth-helper.js";

// Export new SDK-integrated auth utilities (recommended for new projects)
export {
  BrowserOAuthClientProvider,
  onMcpAuthorization,
} from "./src/auth/index.js";
export type { StoredState } from "./src/auth/types.js";

// Export React hooks
export * from "./src/react/index.js";

// Re-export message classes to ensure a single constructor instance is shared by consumers
export {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

// Re-export StreamEvent type from LangChain for convenience
export type { StreamEvent } from "@langchain/core/tracers/log_stream";

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
  WebSocketConnector,
};
