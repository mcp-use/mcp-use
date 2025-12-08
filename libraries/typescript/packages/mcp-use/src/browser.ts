/**
 * Browser entry point - exports OAuth utilities and MCP client/agent for browser-based MCP usage
 */

// Export core client and agent classes - these work in both Node.js and browser
export { BrowserMCPClient as MCPClient } from "./client/browser.js";
export { MCPAgent } from "./agents/mcp_agent.js";
export { RemoteAgent } from "./agents/remote.js";

// Export adapters
export { BaseAdapter, LangChainAdapter } from "./adapters/index.js";

// Export connectors that work in the browser
export { BaseConnector } from "./connectors/base.js";
export type { NotificationHandler } from "./connectors/base.js";
export { HttpConnector } from "./connectors/http.js";
export { WebSocketConnector } from "./connectors/websocket.js";

// Export session and notification types
export { MCPSession } from "./session.js";
export type { Notification, Root } from "./session.js";

// Export OAuth utilities
export { BrowserOAuthClientProvider } from "./auth/browser-provider.js";
export { onMcpAuthorization } from "./auth/callback.js";
export type { StoredState } from "./auth/types.js";

// Export logging (uses browser console in browser environments)
export { Logger, logger } from "./logging.js";

// Export unified telemetry (auto-detects browser/Node.js)
export { Tel, Telemetry, setTelemetrySource } from "./telemetry/index.js";

// Backwards compatibility aliases
export { Tel as BrowserTelemetry } from "./telemetry/index.js";
export { setTelemetrySource as setBrowserTelemetrySource } from "./telemetry/index.js";

// Export observability
export {
  type ObservabilityConfig,
  ObservabilityManager,
} from "./observability/index.js";

// Export AI SDK utilities
export * from "./agents/utils/index.js";

// !!! NEVER EXPORT @langchain/core types it causes OOM errors when building the package
// Note: Message classes are not re-exported to avoid forcing TypeScript to deeply analyze
// @langchain/core types.
// Import them directly from "@langchain/core/messages" if needed.
// Same for StreamEvent - import from "@langchain/core/tracers/log_stream"

// Re-export useful SDK types
export type {
  OAuthClientInformation,
  OAuthMetadata,
  OAuthTokens,
} from "@mcp-use/modelcontextprotocol-sdk/shared/auth.js";

// Export version information (global)
export { getPackageVersion, VERSION } from "./version.js";
