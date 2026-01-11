import type { McpServerOptions } from "../McpClientProvider.js";
import type {
  CachedServerMetadata,
  StorageProvider,
} from "./StorageProvider.js";

/**
 * LocalStorage-based storage provider for browser environments
 *
 * Persists server configurations to browser localStorage with automatic
 * serialization/deserialization. Also supports caching server metadata
 * (name, version, icons) to avoid re-fetching on every connection.
 *
 * @example
 * ```typescript
 * const storage = new LocalStorageProvider("my-servers");
 * const provider = (
 *   <McpClientProvider storageProvider={storage}>
 *     <App />
 *   </McpClientProvider>
 * );
 * ```
 */
export class LocalStorageProvider implements StorageProvider {
  private metadataKey: string;

  constructor(private storageKey: string = "mcp-client-servers") {
    // Use a separate key for metadata to keep it organized
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
    // Also remove metadata when removing a server
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
    const allMetadata = this.getAllMetadata();
    return allMetadata[id];
  }

  setServerMetadata(id: string, metadata: CachedServerMetadata): void {
    const allMetadata = this.getAllMetadata();
    allMetadata[id] = {
      ...metadata,
      cachedAt: Date.now(),
    };
    this.setAllMetadata(allMetadata);
  }

  removeServerMetadata(id: string): void {
    const allMetadata = this.getAllMetadata();
    delete allMetadata[id];
    this.setAllMetadata(allMetadata);
  }
}
