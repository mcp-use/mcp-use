/**
 * Common type definitions shared across different MCP components
 */

import type { OAuthProvider } from "../oauth/providers/types.js";
import type { cors } from "hono/cors";
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
   * Custom CORS options for the server.
   *
   * By default, mcp-use enables permissive CORS (`origin: "*"`) for development ergonomics.
   * Set this to customize allowed origins, headers, methods, credentials, etc.
   *
   * @example
   * ```typescript
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   cors: {
   *     origin: ['https://app.mycompany.com'],
   *     allowMethods: ['GET', 'POST', 'OPTIONS'],
   *   },
   * });
   * ```
   */
  cors?: Partial<Parameters<typeof cors>[0]>;
  /**
   * Allowed origins for DNS rebinding protection
   *
   * - If not set: DNS rebinding protection is disabled (all Host values accepted)
   * - If set to empty array: DNS rebinding protection is disabled
   * - If set with origins: Host validation is enabled globally for the server
   *
   * @example
   * ```typescript
   * // Default behavior (no host validation)
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0'
   * });
   *
   * // Explicit protection (applies to all routes)
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
  sessionIdleTimeoutMs?: number; // Idle timeout for sessions in milliseconds (default: 86400000 = 1 day)
  /**
   * @deprecated This option is deprecated and will be removed in a future version.
   *
   * The MCP specification requires clients to send a new InitializeRequest when they receive
   * a 404 response for a stale session. Modern MCP clients
   * handle this correctly. The server now follows the spec strictly by returning 404 for invalid
   * session IDs.
   *
   * If you need session persistence across server restarts, use the `sessionStore` option
   * with a persistent storage backend (Redis, PostgreSQL, etc.) instead.
   *
   * @see {@link sessionStore} for persistent session storage
   * @see https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management
   */
  autoCreateSessionOnInvalidId?: boolean;
  /**
   * Enable stateless mode (no session tracking)
   * - Default: true for Deno (edge runtimes), false for Node.js
   * - Set to true to force stateless mode
   * - Set to false to force stateful mode (with sessions)
   * - Auto-detected per-request based on client Accept header
   *
   * **Auto-detection (Node.js default):**
   * - Client sends `Accept: application/json, text/event-stream` → Stateful mode
   * - Client sends `Accept: application/json` only → Stateless mode
   * - Explicit `stateless: true` → Always stateless (ignores Accept header)
   *
   * This enables compatibility with k6, curl, and other HTTP-only clients
   * while maintaining full SSE support for capable clients.
   *
   * Stateless mode is required for edge functions where instances don't persist.
   * Stateful mode supports sessions, resumability, and notifications.
   *
   * @example
   * ```typescript
   * // Auto-detected (Deno = stateless, Node.js = stateful with Accept header detection)
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0'
   * });
   *
   * // Force stateless mode (ignores Accept header)
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   stateless: true
   * });
   * ```
   */
  stateless?: boolean;
  /**
   * Custom session metadata storage backend (default: in-memory)
   *
   * Stores serializable session metadata (client capabilities, log level, timestamps).
   * For active SSE stream management, use `streamManager`.
   *
   * Allows pluggable session persistence for scenarios requiring:
   * - Session metadata survival across server restarts
   * - Distributed/clustered deployments
   * - Horizontal scaling with session sharing
   *
   * Default: InMemorySessionStore (metadata lost on restart)
   *
   * @example
   * ```typescript
   * import { MCPServer, RedisSessionStore } from 'mcp-use/server';
   * import { createClient } from 'redis';
   *
   * const redis = createClient({ url: process.env.REDIS_URL });
   * await redis.connect();
   *
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   sessionStore: new RedisSessionStore({ client: redis })
   * });
   * ```
   */
  sessionStore?: import("../sessions/stores/index.js").SessionStore;
  /**
   * Custom stream manager for active SSE connections (default: in-memory)
   *
   * Manages active SSE stream controllers for server-to-client push notifications.
   * Separate from sessionStore to enable distributed notifications via Redis Pub/Sub.
   *
   * Default: InMemoryStreamManager (streams on this server only)
   *
   * For distributed deployments where notifications/sampling need to work across
   * multiple server instances, use RedisStreamManager with Redis Pub/Sub.
   *
   * @example
   * ```typescript
   * import { MCPServer, RedisStreamManager, RedisSessionStore } from 'mcp-use/server';
   * import { createClient } from 'redis';
   *
   * // Create two Redis clients (Pub/Sub requires dedicated client)
   * const redis = createClient({ url: process.env.REDIS_URL });
   * const pubSubRedis = redis.duplicate();
   *
   * await redis.connect();
   * await pubSubRedis.connect();
   *
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   sessionStore: new RedisSessionStore({ client: redis }),
   *   streamManager: new RedisStreamManager({
   *     client: redis,
   *     pubSubClient: pubSubRedis
   *   })
   * });
   *
   * // Now notifications and sampling work across all server instances!
   * ```
   */
  streamManager?: import("../sessions/streams/index.js").StreamManager;
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
  /**
   * Path to favicon file relative to public directory
   *
   * The favicon will be automatically included in all widget pages.
   * Place your favicon file in the public/ directory and specify the relative path.
   *
   * @example
   * ```typescript
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   favicon: 'favicon.ico' // References public/favicon.ico
   * });
   *
   * // For files in subdirectories
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   favicon: 'icons/app-icon.png' // References public/icons/app-icon.png
   * });
   * ```
   */
  favicon?: string;
  /**
   * Display name for the server
   *
   * A human-readable title that will be shown in MCP clients and inspector UI.
   * If not provided, the `name` field will be used as the display name.
   *
   * @example
   * ```typescript
   * const server = new MCPServer({
   *   name: 'my-mcp-server',
   *   title: 'My Awesome MCP Server', // display name
   *   version: '1.0.0'
   * });
   * ```
   */
  title?: string; // display name
  /**
   * Website URL for the server
   *
   * Optional URL to the server's website or documentation.
   * This will be included in the server info displayed to clients.
   *
   * @example
   * ```typescript
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   websiteUrl: 'https://myserver.com'
   * });
   * ```
   */
  websiteUrl?: string;
  /**
   * Array of server icons
   *
   * Icons that represent the server in various sizes and formats.
   * Used by MCP clients and inspector UI to display server branding.
   *
   * @example
   * ```typescript
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   icons: [
   *     {
   *       src: 'icon.svg',
   *       mimeType: 'image/svg+xml',
   *       sizes: ['512x512', '256x256']
   *     },
   *     {
   *       src: 'icon-192.png',
   *       mimeType: 'image/png',
   *       sizes: ['192x192']
   *     }
   *   ]
   * });
   * ```
   */
  icons?: Array<{
    src: string;
    mimeType?: string;
    sizes?: string[];
    theme?: "light" | "dark";
  }>;
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
