import type { Notification, Root } from "@modelcontextprotocol/sdk/types.js";
import type { BaseConnector, NotificationHandler } from "./connectors/base.js";

export class MCPSession {
  readonly connector: BaseConnector;
  private autoConnect: boolean;

  constructor(connector: BaseConnector, autoConnect = true) {
    this.connector = connector;
    this.autoConnect = autoConnect;
  }

  async connect(): Promise<void> {
    await this.connector.connect();
  }

  async disconnect(): Promise<void> {
    await this.connector.disconnect();
  }

  async initialize(): Promise<void> {
    if (!this.isConnected && this.autoConnect) {
      await this.connect();
    }
    await this.connector.initialize();
  }

  get isConnected(): boolean {
    return this.connector && this.connector.isClientConnected;
  }

  /**
   * Register an event handler for session events
   *
   * @param event - The event type to listen for
   * @param handler - The handler function to call when the event occurs
   *
   * @example
   * ```typescript
   * session.on("notification", async (notification) => {
   *   console.log(`Received: ${notification.method}`, notification.params);
   *
   *   if (notification.method === "notifications/tools/list_changed") {
   *     // Refresh tools list
   *   }
   * });
   * ```
   */
  on(event: "notification", handler: NotificationHandler): void {
    if (event === "notification") {
      this.connector.onNotification(handler);
    }
  }

  /**
   * Set roots and notify the server.
   * Roots represent directories or files that the client has access to.
   *
   * @param roots - Array of Root objects with `uri` (must start with "file://") and optional `name`
   *
   * @example
   * ```typescript
   * await session.setRoots([
   *   { uri: "file:///home/user/project", name: "My Project" },
   *   { uri: "file:///home/user/data" }
   * ]);
   * ```
   */
  async setRoots(roots: Root[]): Promise<void> {
    return this.connector.setRoots(roots);
  }

  /**
   * Get the current roots.
   */
  getRoots(): Root[] {
    return this.connector.getRoots();
  }
}

// Re-export types for convenience
export type { Notification, Root };
