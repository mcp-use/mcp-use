/**
 * Browser entry point - exports OAuth utilities and MCP client for browser-based MCP usage.
 *
 * LangChain agents (MCPAgent, RemoteAgent, adapters, observability) live in
 * `mcp-use/browser/agent` so this entry stays free of langchain dependencies.
 */

export { BrowserMCPClient as MCPClient } from "@mcp-use/client";

// Export connectors that work in the browser
export { BaseConnector } from "@mcp-use/client";
export type { NotificationHandler } from "@mcp-use/client";
export { HttpConnector } from "@mcp-use/client";

// Export session and notification types
export { MCPSession } from "@mcp-use/client";
export type { Notification, Root } from "@mcp-use/client";

// Export OAuth utilities (browser OAuth lives in @mcp-use/client)
export { BrowserOAuthClientProvider, onMcpAuthorization } from "@mcp-use/client/auth";
export type { StoredState } from "@mcp-use/client/auth";

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
