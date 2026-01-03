import type { McpServerOptions } from "../McpClientProvider.js";
import type { StorageProvider } from "./StorageProvider.js";

/**
 * In-memory storage provider for testing or non-persistent scenarios
 *
 * Stores server configurations in memory only. Data is lost when the
 * component unmounts or page reloads.
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
  }

  clear(): void {
    this.storage = {};
  }
}
