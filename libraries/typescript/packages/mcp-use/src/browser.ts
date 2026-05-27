/**
 * Browser entry point - exports OAuth utilities and MCP client for browser-based MCP usage.
 *
 * LangChain agents (MCPAgent, RemoteAgent, adapters, observability) live in
 * `mcp-use/browser/agent` so this entry stays free of langchain dependencies.
 */

export { BrowserMCPClient as MCPClient } from "./client/browser.js";

// Export connectors that work in the browser
export { BaseConnector } from "./connectors/base.js";
export type { NotificationHandler } from "./connectors/base.js";
export { HttpConnector } from "./connectors/http.js";

// Export session and notification types
export { MCPSession } from "./session.js";
export type { Notification, Root } from "./session.js";

// Export OAuth utilities
export { BrowserOAuthClientProvider } from "./auth/browser-provider.js";
export { onMcpAuthorization } from "./auth/callback.js";
export type { StoredState } from "./auth/types.js";

// Export logging (uses browser console in browser environments)
export { Logger, logger } from "./logging.js";
export type { LogLevel } from "./logging.js";

// Export browser telemetry (browser-specific implementation)
export {
  Tel,
  Telemetry,
  setTelemetrySource,
} from "./telemetry/telemetry-browser.js";

// Backwards compatibility aliases
export { Tel as BrowserTelemetry } from "./telemetry/telemetry-browser.js";
export { setTelemetrySource as setBrowserTelemetrySource } from "./telemetry/telemetry-browser.js";

// Re-export useful SDK types
export type {
  OAuthClientInformation,
  OAuthMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

// Export version information (global)
export { getPackageVersion, VERSION } from "./version.js";
