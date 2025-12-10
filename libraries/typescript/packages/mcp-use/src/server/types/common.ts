/**
 * Common type definitions shared across different MCP components
 */

import type { OAuthProvider } from "../oauth/providers/types.js";
import type { z } from "zod";

/**
 * Converts Zod optional fields to TypeScript optional properties.
 * Transforms { field: T | undefined } to { field?: T }
 *
 * This utility enables natural destructuring patterns in callbacks:
 * - async ({message}) => ... (without type annotation)
 * - async ({message = "default"}) => ... (with default value)
 *
 * Without this, Zod's z.string().optional() produces { message: string | undefined }
 * which requires the property to be present (though it can be undefined).
 * This type makes it truly optional: { message?: string }
 *
 * Used across all callback types: tools, prompts, and resources.
 */
export type OptionalizeUndefinedFields<T> = {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
    T[K],
    undefined
  >;
} & {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
};

/**
 * Infer input type from a Zod schema with proper optional field handling
 */
export type InferZodInput<S> = S extends z.ZodTypeAny
  ? OptionalizeUndefinedFields<z.infer<S>>
  : Record<string, any>;

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
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0'
   * });
   *
   * // Production: Explicitly set allowed origins
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
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
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0'
   * });
   *
   * // Use strict MCP spec behavior (requires compliant clients)
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   autoCreateSessionOnInvalidId: false
   * });
   * ```
   */
  autoCreateSessionOnInvalidId?: boolean; // Default: true (compatible with non-compliant clients)
  /**
   * Enable stateless mode (no session tracking)
   * - Default: true for Deno (edge runtimes), false for Node.js
   * - Set to true to force stateless mode
   * - Set to false to force stateful mode (with sessions)
   *
   * Stateless mode is required for edge functions where instances don't persist.
   * Stateful mode supports sessions, resumability, and notifications.
   *
   * @example
   * ```typescript
   * // Auto-detected (Deno = stateless, Node.js = stateful)
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0'
   * });
   *
   * // Force stateless mode (e.g., for Node.js edge functions)
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   stateless: true
   * });
   * ```
   */
  stateless?: boolean;
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
   * import { MCPServer, oauthSupabaseProvider } from 'mcp-use/server';
   *
   * // Supabase OAuth
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   oauth: oauthSupabaseProvider({
   *     projectId: 'my-project',
   *     jwtSecret: process.env.SUPABASE_JWT_SECRET
   *   })
   * });
   *
   * // Auth0 OAuth
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   oauth: oauthAuth0Provider({
   *     domain: 'my-tenant.auth0.com',
   *     audience: 'https://my-api.com'
   *   })
   * });
   *
   * // Keycloak OAuth
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
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
  default?: unknown;
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
