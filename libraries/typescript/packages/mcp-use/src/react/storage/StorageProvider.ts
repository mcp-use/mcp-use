import type { McpServerOptions } from "../McpClientProvider.js";

/**
 * Storage provider interface for persisting server configurations
 *
 * Implementations can use localStorage, IndexedDB, AsyncStorage, or any other storage mechanism.
 * Supports both sync and async operations.
 */
export interface StorageProvider {
  /**
   * Get all stored server configurations
   * @returns Object mapping server IDs to their configurations
   */
  getServers():
    | Promise<Record<string, McpServerOptions>>
    | Record<string, McpServerOptions>;

  /**
   * Set all server configurations (replaces existing)
   * @param servers - Object mapping server IDs to configurations
   */
  setServers(servers: Record<string, McpServerOptions>): Promise<void> | void;

  /**
   * Add or update a single server configuration
   * @param id - Server ID
   * @param config - Server configuration
   */
  setServer(id: string, config: McpServerOptions): Promise<void> | void;

  /**
   * Remove a server configuration
   * @param id - Server ID to remove
   */
  removeServer(id: string): Promise<void> | void;

  /**
   * Clear all server configurations
   */
  clear(): Promise<void> | void;
}
