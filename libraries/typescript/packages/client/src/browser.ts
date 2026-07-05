/**
 * Browser entry point — the browser-safe subset of `@mcp-use/client`.
 *
 * Unlike the root `.` export (which pulls the Node stdio connector), this entry
 * excludes Node-only code so it is safe to bundle for the browser. Mirrors the
 * historical `mcp-use/browser` surface for compatibility.
 */

export { BrowserMCPClient as MCPClient } from "./client/browser.js";

// Connectors that work in the browser
export { BaseConnector } from "./connectors/base.js";
export type { NotificationHandler } from "./connectors/base.js";
export { HttpConnector } from "./connectors/http.js";

// Session and notification types
export { MCPSession } from "./session.js";
export type { Notification, Root } from "./session.js";

// OAuth utilities
export { BrowserOAuthClientProvider } from "./auth/browser-provider.js";
export { onMcpAuthorization } from "./auth/callback.js";
export type { StoredState } from "./auth/types.js";

// Logging (uses browser console in browser environments)
export { Logger, logger } from "./logging.js";
export type { LogLevel } from "./logging.js";

// Browser telemetry (browser-specific implementation)
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
} from "@modelcontextprotocol/client";

// Version information (global)
export { getPackageVersion, VERSION } from "./version.js";
