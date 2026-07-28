import {
  toPersistedServerConfig,
  type McpServerConfig,
  type PersistedMcpServerConfig,
} from "./types.js";

/** Cached presentation metadata for a managed MCP server. */
export interface CachedServerMetadata {
  /** Programmatic server name. */
  name?: string;
  /** Server version. */
  version?: string;
  /** Human-readable server title. */
  title?: string;
  /** Public server website. */
  websiteUrl?: string;
  /** Icons advertised by the server. */
  icons?: Array<{
    /** Icon URL. */
    src: string;
    /** Icon media type. */
    mimeType?: string;
  }>;
  /** Resolved icon data URL used by the UI. */
  icon?: string;
  /** Unix timestamp in milliseconds when the metadata was cached. */
  cachedAt?: number;
}

/**
 * Persists managed server configurations and optional presentation metadata.
 *
 * Implementations may be synchronous or asynchronous.
 */
export interface StorageProvider {
  /** Returns all saved server configurations keyed by server ID. */
  getServers():
    | Promise<Record<string, PersistedMcpServerConfig>>
    | Record<string, PersistedMcpServerConfig>;
  /** Replaces all saved server configurations. */
  setServers(
    servers: Record<string, PersistedMcpServerConfig>
  ): Promise<void> | void;
  /** Saves one server configuration. */
  setServer(id: string, config: PersistedMcpServerConfig): Promise<void> | void;
  /** Removes one saved server configuration. */
  removeServer(id: string): Promise<void> | void;
  /** Removes all saved configurations and metadata. */
  clear(): Promise<void> | void;
  /** Returns cached metadata for one server, when supported. */
  getServerMetadata?(
    id: string
  ):
    | Promise<CachedServerMetadata | undefined>
    | CachedServerMetadata
    | undefined;
  /** Saves cached metadata for one server, when supported. */
  setServerMetadata?(
    id: string,
    metadata: CachedServerMetadata
  ): Promise<void> | void;
  /** Removes cached metadata for one server, when supported. */
  removeServerMetadata?(id: string): Promise<void> | void;
}

/** Stores managed server configurations in browser `localStorage`. */
export class LocalStorageProvider implements StorageProvider {
  private metadataKey: string;

  /**
   * Creates a browser storage provider.
   *
   * @param storageKey - Key used for configurations. Metadata uses the same key
   * with a `-metadata` suffix. Defaults to `"mcp-client-servers"`.
   */
  constructor(private storageKey: string = "mcp-client-servers") {
    this.metadataKey = `${storageKey}-metadata`;
  }

  /** Returns sanitized server configurations from `localStorage`. */
  getServers(): Record<string, PersistedMcpServerConfig> {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return {};
      const parsed: unknown = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      const sanitized = Object.fromEntries(
        Object.entries(parsed).flatMap(([id, config]) =>
          config && typeof config === "object" && !Array.isArray(config)
            ? [
                [
                  id,
                  toPersistedServerConfig(config as McpServerConfig),
                ] as const,
              ]
            : []
        )
      );
      const serialized = JSON.stringify(sanitized);
      if (serialized !== stored) {
        try {
          localStorage.setItem(this.storageKey, serialized);
        } catch {
          console.error(
            "[LocalStorageProvider] Failed to persist sanitized servers."
          );
        }
      }
      return sanitized;
    } catch {
      console.error("[LocalStorageProvider] Failed to load servers.");
      return {};
    }
  }

  /** Replaces all saved server configurations. */
  setServers(servers: Record<string, PersistedMcpServerConfig>): void {
    try {
      const sanitized = Object.fromEntries(
        Object.entries(servers).map(([id, config]) => [
          id,
          toPersistedServerConfig(config),
        ])
      );
      localStorage.setItem(this.storageKey, JSON.stringify(sanitized));
    } catch {
      console.error("[LocalStorageProvider] Failed to save servers.");
    }
  }

  /** Saves one server configuration. */
  setServer(id: string, config: PersistedMcpServerConfig): void {
    const servers = this.getServers();
    servers[id] = config;
    this.setServers(servers);
  }

  /** Removes one server and its cached metadata. */
  removeServer(id: string): void {
    const servers = this.getServers();
    delete servers[id];
    this.setServers(servers);
    this.removeServerMetadata(id);
  }

  /** Removes all saved configurations and metadata. */
  clear(): void {
    try {
      localStorage.removeItem(this.storageKey);
      localStorage.removeItem(this.metadataKey);
    } catch {
      console.error("[LocalStorageProvider] Failed to clear.");
    }
  }

  private getAllMetadata(): Record<string, CachedServerMetadata> {
    try {
      const stored = localStorage.getItem(this.metadataKey);
      return stored ? JSON.parse(stored) : {};
    } catch {
      console.error("[LocalStorageProvider] Failed to load metadata.");
      return {};
    }
  }

  private setAllMetadata(metadata: Record<string, CachedServerMetadata>): void {
    try {
      localStorage.setItem(this.metadataKey, JSON.stringify(metadata));
    } catch {
      console.error("[LocalStorageProvider] Failed to save metadata.");
    }
  }

  /** Returns cached presentation metadata for a server. */
  getServerMetadata(id: string): CachedServerMetadata | undefined {
    return this.getAllMetadata()[id];
  }

  /** Saves presentation metadata and stamps the current cache time. */
  setServerMetadata(id: string, metadata: CachedServerMetadata): void {
    const allMetadata = this.getAllMetadata();
    allMetadata[id] = { ...metadata, cachedAt: Date.now() };
    this.setAllMetadata(allMetadata);
  }

  /** Removes cached presentation metadata for a server. */
  removeServerMetadata(id: string): void {
    const allMetadata = this.getAllMetadata();
    delete allMetadata[id];
    this.setAllMetadata(allMetadata);
  }
}

/** Stores managed server configurations in memory for tests or ephemeral UIs. */
export class MemoryStorageProvider implements StorageProvider {
  private storage: Record<string, PersistedMcpServerConfig> = {};
  private metadata: Record<string, CachedServerMetadata> = {};

  /** Returns a shallow copy of all stored server configurations. */
  getServers(): Record<string, PersistedMcpServerConfig> {
    return { ...this.storage };
  }

  /** Replaces all stored server configurations. */
  setServers(servers: Record<string, PersistedMcpServerConfig>): void {
    this.storage = Object.fromEntries(
      Object.entries(servers).map(([id, config]) => [
        id,
        toPersistedServerConfig(config),
      ])
    );
  }

  /** Stores one server configuration. */
  setServer(id: string, config: PersistedMcpServerConfig): void {
    this.storage[id] = toPersistedServerConfig(config);
  }

  /** Removes one server and its cached metadata. */
  removeServer(id: string): void {
    delete this.storage[id];
    this.removeServerMetadata(id);
  }

  /** Removes all configurations and metadata. */
  clear(): void {
    this.storage = {};
    this.metadata = {};
  }

  /** Returns cached presentation metadata for a server. */
  getServerMetadata(id: string): CachedServerMetadata | undefined {
    return this.metadata[id];
  }

  /** Saves presentation metadata and stamps the current cache time. */
  setServerMetadata(id: string, metadata: CachedServerMetadata): void {
    this.metadata[id] = { ...metadata, cachedAt: Date.now() };
  }

  /** Removes cached presentation metadata for a server. */
  removeServerMetadata(id: string): void {
    delete this.metadata[id];
  }
}
