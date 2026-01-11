export { ConnectionManager } from "./base.js";

/**
 * @deprecated Use StreamableHttpConnectionManager instead.
 *
 * SseConnectionManager uses the deprecated SSEClientTransport from the official SDK.
 * StreamableHttpConnectionManager provides the same SSE functionality through a unified
 * endpoint per MCP spec 2025-11-25.
 *
 * This export is maintained for backward compatibility. See SseConnectionManager class
 * documentation for migration guide.
 */
export { SseConnectionManager } from "./sse.js";

export { StdioConnectionManager } from "./stdio.js";
export { StreamableHttpConnectionManager } from "./streamable_http.js";
