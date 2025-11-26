/**
 * Common type definitions shared across different MCP components
 */

export interface ServerConfig {
  name: string;
  version: string;
  description?: string;
  host?: string; // Hostname for widget URLs and server endpoints (defaults to 'localhost')
  baseUrl?: string; // Full base URL (e.g., 'https://myserver.com') - overrides host:port for widget URLs
  /**
   * Allowed origins for DNS rebinding protection
   *
   * **Development mode** (NODE_ENV !== "production"):
   * - If not set: All origins are allowed (DNS rebinding protection disabled)
   * - This enables direct browser connections from any origin for easier development
   *
   * **Production mode** (NODE_ENV === "production"):
   * - If not set: DNS rebinding protection is disabled (not recommended for production)
   * - If set to empty array: DNS rebinding protection is disabled
   * - If set with origins: DNS rebinding protection is enabled with those specific origins
   *
   * @example
   * ```typescript
   * // Development: No need to set (allows all origins)
   * const server = createMCPServer('my-server');
   *
   * // Production: Explicitly set allowed origins
   * const server = createMCPServer('my-server', {
   *   allowedOrigins: [
   *     'https://myapp.com',
   *     'https://app.myapp.com'
   *   ]
   * });
   * ```
   */
  allowedOrigins?: string[];
  sessionIdleTimeoutMs?: number; // Idle timeout for sessions in milliseconds (default: 300000 = 5 minutes)
  /**
   * Automatically create a new session when a request is received with an invalid/expired session ID.
   *
   * **Default: true** (enables compatibility with non-compliant clients like ChatGPT)
   *
   * When set to `true` (default), the server will automatically create a new session when it receives
   * a request with an invalid or expired session ID. This allows clients to seamlessly
   * reconnect after server restarts without needing to send a new `initialize` request.
   *
   * **Note**: According to the [MCP protocol specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management),
   * clients **MUST** start a new session by sending a new `InitializeRequest` when they receive
   * HTTP 404 in response to a request containing an `MCP-Session-Id`. However, some clients (like
   * ChatGPT) don't properly handle this and fail to reconnect. Setting this to `true` enables
   * compatibility with these non-compliant clients.
   *
   * When set to `false`, the server follows the MCP protocol specification strictly:
   * it returns HTTP 404 Not Found for requests with invalid session IDs, requiring
   * clients to explicitly send a new `initialize` request.
   *
   * @example
   * ```typescript
   * // Default behavior (compatible with ChatGPT and other non-compliant clients)
   * const server = createMCPServer('my-server');
   *
   * // Use strict MCP spec behavior (requires compliant clients)
   * const server = createMCPServer('my-server', {
   *   autoCreateSessionOnInvalidId: false
   * });
   * ```
   */
  autoCreateSessionOnInvalidId?: boolean; // Default: true (compatible with non-compliant clients)
}

export interface InputDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  default?: any;
}

/**
 * Annotations provide hints to clients about how to use or display resources
 */
export interface ResourceAnnotations {
  /** Intended audience(s) for this resource */
  audience?: ("user" | "assistant")[];
  /** Priority from 0.0 (least important) to 1.0 (most important) */
  priority?: number;
  /** ISO 8601 formatted timestamp of last modification */
  lastModified?: string;
}
