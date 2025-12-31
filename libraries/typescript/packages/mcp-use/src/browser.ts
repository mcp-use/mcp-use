/**
 * Browser entry point - exports OAuth utilities and MCP client for browser-based MCP usage
 * 
 * Note: MCPAgent and RemoteAgent are NOT exported here as they require Node.js dependencies
 * (langchain, fs, child_process). Use them from the server build instead.
 */

// Export core client class - works in both Node.js and browser
export { BrowserMCPClient as MCPClient } from "./client/browser.js";

// Export adapters
export { BaseAdapter } from "./adapters/index.js";

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

// Note: Logger and Telemetry not exported from browser build to avoid winston/posthog-node dependencies
// Import them from the main package or server build if needed in Node.js environments

// Note: ObservabilityManager not exported from browser build
// It has logging dependencies that pull in winston

// Export AI SDK utilities (browser-safe only)
// Note: Removed wildcard export to avoid bundling Node.js dependencies
// Import specific utilities from the server build if needed

// !!! NEVER EXPORT @langchain/core types it causes OOM errors when building the package
// Note: Message classes are not re-exported to avoid forcing TypeScript to deeply analyze
// @langchain/core types.
// Import them directly from "@langchain/core/messages" if needed.
// Same for StreamEvent - import from "@langchain/core/tracers/log_stream"

// Re-export useful SDK types
export type {
    OAuthClientInformation,
    OAuthMetadata,
    OAuthTokens
} from "@mcp-use/modelcontextprotocol-sdk/shared/auth.js";

// Export version information (global)
export { VERSION, getPackageVersion } from "./version.js";

