/**
 * Extended Hono Context types for MCP server
 */

import type { Context as HonoContext } from "hono";
import type { AuthInfo } from "../oauth/utils.js";

/**
 * Base MCP Context without OAuth
 */
export interface McpContextBase extends HonoContext {
  auth?: never;
}

/**
 * MCP Context with OAuth configured
 *
 * When OAuth is configured, the auth property is automatically populated
 * by the OAuth middleware and guaranteed to be available in tool callbacks.
 */
export interface McpContextWithAuth extends HonoContext {
  /**
   * Authentication information from OAuth provider
   *
   * Includes user info, JWT payload, access token, scopes, and permissions.
   * Always available when OAuth is configured since tools are protected by default.
   *
   * TypeScript knows this is always defined (non-undefined) when OAuth is configured.
   */
  auth: AuthInfo;

  // Helper to narrow the type
  readonly __hasOAuth?: true;
}

/**
 * Conditional MCP Context type based on OAuth configuration
 */
export type McpContext<HasOAuth extends boolean = false> = HasOAuth extends true
  ? McpContextWithAuth
  : McpContextBase;
