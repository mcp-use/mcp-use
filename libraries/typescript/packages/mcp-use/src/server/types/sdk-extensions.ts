/**
 * Temporary type extensions for MCP SDK types until SEP-973 is fully implemented in the SDK.
 * 
 * These types extend the official SDK types to include icons and websiteUrl support.
 * Once the SDK is updated with SEP-973 support, these extensions can be removed.
 * 
 * @see https://github.com/modelcontextprotocol/specification/blob/main/SEPs/sep-973-icons-and-website-url.md
 */

import type { Icon } from "./common.js";

/**
 * Extended server capabilities with SEP-973 icon and websiteUrl support
 */
export interface ExtendedServerCapabilities {
  name: string;
  version: string;
  icons?: Icon[];
  websiteUrl?: string;
}

/**
 * Extended tool metadata with SEP-973 icon support
 */
export interface ExtendedToolMetadata {
  title?: string;
  description?: string;
  inputSchema?: Record<string, any>;
  annotations?: any;
  icons?: Icon[];
  _meta?: Record<string, unknown>;
}

/**
 * Extended resource metadata with SEP-973 icon support
 */
export interface ExtendedResourceMetadata {
  title?: string;
  description?: string;
  mimeType?: string;
  icons?: Icon[];
  _meta?: Record<string, unknown>;
}

/**
 * Extended prompt metadata with SEP-973 icon support
 */
export interface ExtendedPromptMetadata {
  title?: string;
  description?: string;
  argsSchema?: any;
  icons?: Icon[];
}
