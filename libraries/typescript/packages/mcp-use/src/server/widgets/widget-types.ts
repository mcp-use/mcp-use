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
  type: "appsSdk";
  props: import("../types/resource.js").WidgetProps;
  _meta: Record<string, unknown>;
  htmlTemplate: string;
  appsSdkMetadata: import("../types/resource.js").AppsSdkMetadata;
}) => void;
