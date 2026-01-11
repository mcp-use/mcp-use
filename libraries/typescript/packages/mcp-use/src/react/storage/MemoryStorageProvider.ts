import type { McpServerOptions } from "../McpClientProvider.js";
import type {
  CachedServerMetadata,
  StorageProvider,
} from "./StorageProvider.js";

/**
 * In-memory storage provider for testing or non-persistent scenarios
 *
 * Stores server configurations in memory only. Data is lost when the
 * component unmounts or page reloads. Also supports caching server metadata.
 *
 * @example
 * ```typescript
 * // Useful for testing
 * const storage = new MemoryStorageProvider();
 * const provider = (
 *   <McpClientProvider storageProvider={storage}>
 *     <App />
 *   </McpClientProvider>
 * );
 * ```
 */
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
    this.metadata[id] = {
      ...metadata,
      cachedAt: Date.now(),
    };
  }

  removeServerMetadata(id: string): void {
    delete this.metadata[id];
  }
}
