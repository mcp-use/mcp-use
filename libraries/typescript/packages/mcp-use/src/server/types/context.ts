/**
 * Extended Hono Context types for MCP server
 */

import type { Context as HonoContext } from "hono";
import type { AuthInfo } from "../oauth/utils.js";

/**
 * Client capability checker interface, available as `ctx.client` in all
 * tool, resource, and prompt callbacks.
 */
export interface ClientCapabilityChecker {
  /** Returns true if the client advertised the given top-level capability */
  can(capability: string): boolean;
  /** Returns all capabilities advertised by the client */
  capabilities(): Record<string, any>;
  /** Returns the client's name and version from the initialize handshake */
  info(): { name?: string; version?: string };
  /**
   * Returns the settings for a specific MCP extension (SEP-1724), or
   * `undefined` if the client did not advertise it.
   */
  extension(id: string): Record<string, any> | undefined;
  /**
   * Returns `true` if the client supports MCP Apps
   * (`io.modelcontextprotocol/ui` extension, SEP-1865).
   */
  supportsApps(): boolean;
}

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
