import type { McpServerOptions } from "./types.js";

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
    | Promise<Record<string, McpServerOptions>>
    | Record<string, McpServerOptions>;
  setServers(servers: Record<string, McpServerOptions>): Promise<void> | void;
  setServer(id: string, config: McpServerOptions): Promise<void> | void;
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

  getServers(): Record<string, McpServerOptions> {
    try {
      const stored = localStorage.getItem(this.storageKey);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error("[LocalStorageProvider] Failed to load servers:", error);
      return {};
    }
  }

  setServers(servers: Record<string, McpServerOptions>): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(servers));
    } catch (error) {
      console.error("[LocalStorageProvider] Failed to save servers:", error);
    }
  }

  setServer(id: string, config: McpServerOptions): void {
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
    } catch (error) {
      console.error("[LocalStorageProvider] Failed to clear:", error);
    }
  }

  private getAllMetadata(): Record<string, CachedServerMetadata> {
    try {
      const stored = localStorage.getItem(this.metadataKey);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error("[LocalStorageProvider] Failed to load metadata:", error);
      return {};
    }
  }

  private setAllMetadata(metadata: Record<string, CachedServerMetadata>): void {
    try {
      localStorage.setItem(this.metadataKey, JSON.stringify(metadata));
    } catch (error) {
      console.error("[LocalStorageProvider] Failed to save metadata:", error);
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
  private storage: Record<string, McpServerOptions> = {};
  private metadata: Record<string, CachedServerMetadata> = {};

  getServers(): Record<string, McpServerOptions> {
    return { ...this.storage };
  }

  setServers(servers: Record<string, McpServerOptions>): void {
    this.storage = { ...servers };
  }

  setServer(id: string, config: McpServerOptions): void {
    this.storage[id] = config;
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
