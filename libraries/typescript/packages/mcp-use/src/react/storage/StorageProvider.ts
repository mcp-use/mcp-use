import type { McpServerOptions } from "../McpClientProvider.js";

/**
 * Cached server metadata that should be persisted alongside configurations
 */
export interface CachedServerMetadata {
  /** Server name from the MCP server's initialize response */
  name?: string;
  /** Server version */
  version?: string;
  /** Server title (if provided) */
  title?: string;
  /** Server website URL */
  websiteUrl?: string;
  /** Server icons */
  icons?: Array<{
    src: string;
    mimeType?: string;
  }>;
  /** Base64-encoded server icon (favicon or first icon from icons array) */
  icon?: string;
  /** Timestamp when this metadata was cached */
  cachedAt?: number;
}

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

  /**
   * Get cached server metadata
   * @param id - Server ID
   * @returns Cached metadata or undefined if not found
   */
  getServerMetadata?(
    id: string
  ):
    | Promise<CachedServerMetadata | undefined>
    | CachedServerMetadata
    | undefined;

  /**
   * Set cached server metadata
   * @param id - Server ID
   * @param metadata - Server metadata to cache
   */
  setServerMetadata?(
    id: string,
    metadata: CachedServerMetadata
  ): Promise<void> | void;

  /**
   * Remove cached server metadata
   * @param id - Server ID
   */
  removeServerMetadata?(id: string): Promise<void> | void;
}
