import type { McpServerOptions } from "../McpClientProvider.js";
import type { StorageProvider } from "./StorageProvider.js";

/**
 * LocalStorage-based storage provider for browser environments
 *
 * Persists server configurations to browser localStorage with automatic
 * serialization/deserialization.
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
  constructor(private storageKey: string = "mcp-client-servers") {}

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
  }

  clear(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.error("[LocalStorageProvider] Failed to clear:", error);
    }
  }
}
