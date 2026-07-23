import {
  toPersistedServerConfig,
  type McpServerConfig,
  type PersistedMcpServerConfig,
} from "./types.js";

export interface CachedServerMetadata {
  name?: string;
  version?: string;
  title?: string;
  websiteUrl?: string;
  icons?: Array<{
    src: string;
    mimeType?: string;
  }>;
  icon?: string;
  cachedAt?: number;
}

export interface StorageProvider {
  getServers():
    | Promise<Record<string, PersistedMcpServerConfig>>
    | Record<string, PersistedMcpServerConfig>;
  setServers(
    servers: Record<string, PersistedMcpServerConfig>
  ): Promise<void> | void;
  setServer(id: string, config: PersistedMcpServerConfig): Promise<void> | void;
  removeServer(id: string): Promise<void> | void;
  clear(): Promise<void> | void;
  getServerMetadata?(
    id: string
  ):
    | Promise<CachedServerMetadata | undefined>
    | CachedServerMetadata
    | undefined;
  setServerMetadata?(
    id: string,
    metadata: CachedServerMetadata
  ): Promise<void> | void;
  removeServerMetadata?(id: string): Promise<void> | void;
}

export class LocalStorageProvider implements StorageProvider {
  private metadataKey: string;

  constructor(private storageKey: string = "mcp-client-servers") {
    this.metadataKey = `${storageKey}-metadata`;
  }

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
        localStorage.setItem(this.storageKey, serialized);
      }
      return sanitized;
    } catch {
      console.error("[LocalStorageProvider] Failed to load servers.");
      return {};
    }
  }

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

  setServer(id: string, config: PersistedMcpServerConfig): void {
    const servers = this.getServers();
    servers[id] = config;
    this.setServers(servers);
  }

  removeServer(id: string): void {
    const servers = this.getServers();
    delete servers[id];
    this.setServers(servers);
    this.removeServerMetadata(id);
  }

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

  getServerMetadata(id: string): CachedServerMetadata | undefined {
    return this.getAllMetadata()[id];
  }

  setServerMetadata(id: string, metadata: CachedServerMetadata): void {
    const allMetadata = this.getAllMetadata();
    allMetadata[id] = { ...metadata, cachedAt: Date.now() };
    this.setAllMetadata(allMetadata);
  }

  removeServerMetadata(id: string): void {
    const allMetadata = this.getAllMetadata();
    delete allMetadata[id];
    this.setAllMetadata(allMetadata);
  }
}

export class MemoryStorageProvider implements StorageProvider {
  private storage: Record<string, PersistedMcpServerConfig> = {};
  private metadata: Record<string, CachedServerMetadata> = {};

  getServers(): Record<string, PersistedMcpServerConfig> {
    return { ...this.storage };
  }

  setServers(servers: Record<string, PersistedMcpServerConfig>): void {
    this.storage = Object.fromEntries(
      Object.entries(servers).map(([id, config]) => [
        id,
        toPersistedServerConfig(config),
      ])
    );
  }

  setServer(id: string, config: PersistedMcpServerConfig): void {
    this.storage[id] = toPersistedServerConfig(config);
  }

  removeServer(id: string): void {
    delete this.storage[id];
    this.removeServerMetadata(id);
  }

  clear(): void {
    this.storage = {};
    this.metadata = {};
  }

  getServerMetadata(id: string): CachedServerMetadata | undefined {
    return this.metadata[id];
  }

  setServerMetadata(id: string, metadata: CachedServerMetadata): void {
    this.metadata[id] = { ...metadata, cachedAt: Date.now() };
  }

  removeServerMetadata(id: string): void {
    delete this.metadata[id];
  }
}
