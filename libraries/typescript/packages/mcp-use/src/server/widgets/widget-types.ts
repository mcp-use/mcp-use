/**
 * Shared type definitions for widget mounting and serving
 *
 * This module consolidates common types used across widget-related modules
 * to avoid duplication and ensure consistency.
 */

/**
 * Server configuration for widget mounting
 *
 * Unified interface used by both development and production widget mounting,
 * as well as static route setup.
 */
export interface ServerConfig {
  /** Base URL of the server */
  serverBaseUrl: string;
  /** Server port (optional for production) */
  serverPort?: number | string;
  /** Additional CSP URLs for widget security */
  cspUrls: string[];
  /** Build ID from manifest for cache busting (optional) */
  buildId?: string;
  /** Path to favicon file relative to public directory (optional) */
  favicon?: string;
  /** Whether public routes have been set up and in what mode (optional) */
  publicRoutesMode?: "dev" | "production" | null;
  /** Pre-created HTTP server for Vite HMR WebSocket support (optional, Node.js only) */

  httpServer?: any;
}

/**
 * Widget mounting options
 *
 * Common options used for both development and production widget mounting.
 */
export interface MountWidgetsOptions {
  /** Base route for widgets (defaults to '/mcp-use/widgets') */
  baseRoute?: string;
  /** Resources directory path (defaults to 'resources') */
  resourcesDir?: string;
}

/**
 * Widget registration callback function type
 *
 * Used to register discovered widgets with the MCP server.
 */
export type RegisterWidgetCallback = (widgetDefinition: {
  name: string;
  title: string;
  description: string;
  type: "appsSdk" | "mcpApps";
  props: import("../types/resource.js").WidgetProps;
  _meta: Record<string, unknown>;
  htmlTemplate: string;
  appsSdkMetadata?: import("../types/resource.js").AppsSdkMetadata;
  metadata?: Record<string, any>;
}) => void;

/**
 * Widget tool update callback function type
 *
 * Used to update widget tool metadata during HMR without re-registering.
 */
export type UpdateWidgetToolCallback = (
  toolName: string,
  updates: {
    description?: string;
    schema?: unknown; // Raw Zod schema - will be converted by the server
    _meta?: Record<string, unknown>;
  }
) => boolean;

/**
 * Widget tool removal callback function type
 *
 * Used to remove widget tool and resources during HMR (e.g., when widget is renamed/deleted).
 */
export type RemoveWidgetToolCallback = (toolName: string) => void;
