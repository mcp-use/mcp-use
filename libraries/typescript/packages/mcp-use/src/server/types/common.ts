/**
 * Common type definitions shared across different MCP components
 */

import type { OAuthProvider } from "../oauth/providers/types.js";

/**
 * A url pointing to an icon URL or a base64-encoded data URI
 *
 * Clients that support rendering icons MUST support at least the following MIME types:
 * - image/png - PNG images (safe, universal compatibility)
 * - image/jpeg (and image/jpg) - JPEG images (safe, universal compatibility)
 *
 * Clients that support rendering icons SHOULD also support:
 * - image/svg+xml - SVG images (scalable but requires security precautions)
 * - image/webp - WebP images (modern, efficient format)
 */
export interface Icon {
  /**
   * A standard URI pointing to an icon resource or a base64-encoded data URI.
   *
   * Consumers MUST take steps to ensure URLs serving icons are from the
   * same domain as the client/server or a trusted domain.
   *
   * Consumers MUST take appropriate precautions when consuming SVGs as they can contain
   * executable JavaScript
   *
   * @format uri
   */
  src: string;
  /** Optional override if the server's MIME type is missing or generic. */
  mimeType?: string;
  /** e.g. "48x48", "any" (for SVG), or "48x48 96x96" */
  sizes?: string;
}

export interface ServerConfig {
  name: string;
  version: string;
  description?: string;
  /**
   * An optional list of icons for this implementation.
   * This can be used by clients to display the implementation in a user interface.
   * Each icon should have a `src` property that points to the icon file or data representation, and may also include a `mimeType` and `sizes` property.
   * The `mimeType` property should be a valid MIME type for the icon file, such as "image/png" or "image/svg+xml".
   * The `sizes` property should be a string that specifies one or more sizes at which the icon file can be used, such as "48x48" or "any" for scalable formats like SVG.
   * The `sizes` property is optional, and if not provided, the client should assume that the icon can be used at any size.
   */
  icons?: Icon[];
  /**
   * An optional URL of the website for this implementation.
   *
   * Consumers MUST take steps to ensure URLs are from the
   * same domain as the client/server or a trusted domain.
   *
   * @format uri
   */
  websiteUrl?: string;
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
  /**
   * OAuth authentication configuration
   *
   * When provided, automatically sets up OAuth authentication for the server including:
   * - OAuth routes (/authorize, /token, .well-known/*)
   * - JWT verification middleware
   * - Bearer token authentication on all /mcp routes
   * - User information extraction and context attachment
   *
   * Use provider factory functions for type-safe configuration:
   * - oauthSupabaseProvider() - Supabase OAuth
   * - oauthAuth0Provider() - Auth0 OAuth
   * - oauthKeycloakProvider() - Keycloak OAuth
   * - oauthCustomProvider() - Custom OAuth implementation
   *
   * @example
   * ```typescript
   * import { createMCPServer, oauthSupabaseProvider } from 'mcp-use/server';
   *
   * // Supabase OAuth
   * const server = createMCPServer('my-server', {
   *   oauth: oauthSupabaseProvider({
   *     projectId: 'my-project',
   *     jwtSecret: process.env.SUPABASE_JWT_SECRET
   *   })
   * });
   *
   * // Auth0 OAuth
   * const server = createMCPServer('my-server', {
   *   oauth: oauthAuth0Provider({
   *     domain: 'my-tenant.auth0.com',
   *     audience: 'https://my-api.com'
   *   })
   * });
   *
   * // Keycloak OAuth
   * const server = createMCPServer('my-server', {
   *   oauth: oauthKeycloakProvider({
   *     serverUrl: 'https://keycloak.example.com',
   *     realm: 'my-realm',
   *     clientId: 'my-client'
   *   })
   * });
   * ```
   */
  oauth?: OAuthProvider;
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
