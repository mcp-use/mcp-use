import type {
  CallToolResult,
  Notification,
  Root,
  Tool,
} from "@mcp-use/modelcontextprotocol-sdk/types.js";
import type { RequestOptions } from "@mcp-use/modelcontextprotocol-sdk/shared/protocol.js";
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

  /**
   * Get the cached list of tools from the server.
   *
   * @returns Array of available tools
   *
   * @example
   * ```typescript
   * const tools = session.tools;
   * console.log(`Available tools: ${tools.map(t => t.name).join(", ")}`);
   * ```
   */
  get tools(): Tool[] {
    return this.connector.tools;
  }

  /**
   * List all available tools from the MCP server.
   * This method fetches fresh tools from the server, unlike the `tools` getter which returns cached tools.
   *
   * @param options - Optional request options
   * @returns Array of available tools
   *
   * @example
   * ```typescript
   * const tools = await session.listTools();
   * console.log(`Available tools: ${tools.map(t => t.name).join(", ")}`);
   * ```
   */
  async listTools(options?: RequestOptions): Promise<Tool[]> {
    return this.connector.listTools(options);
  }

  /**
   * Get the server capabilities advertised during initialization.
   *
   * @returns Server capabilities object
   */
  get serverCapabilities(): Record<string, unknown> {
    return this.connector.serverCapabilities;
  }

  /**
   * Get the server information (name and version).
   *
   * @returns Server info object or null if not available
   */
  get serverInfo(): { name: string; version?: string } | null {
    return this.connector.serverInfo;
  }

  /**
   * Call a tool on the server.
   *
   * @param name - Name of the tool to call
   * @param args - Arguments to pass to the tool (defaults to empty object)
   * @param options - Optional request options (timeout, progress handlers, etc.)
   * @returns Result from the tool execution
   *
   * @example
   * ```typescript
   * const result = await session.callTool("add", { a: 5, b: 3 });
   * console.log(`Result: ${result.content[0].text}`);
   * ```
   */
  async callTool(
    name: string,
    args: Record<string, any> = {},
    options?: RequestOptions
  ): Promise<CallToolResult> {
    return this.connector.callTool(name, args, options);
  }

  /**
   * List resources from the server with optional pagination.
   *
   * @param cursor - Optional cursor for pagination
   * @param options - Request options
   * @returns Resource list with optional nextCursor for pagination
   *
   * @example
   * ```typescript
   * const result = await session.listResources();
   * console.log(`Found ${result.resources.length} resources`);
   * ```
   */
  async listResources(cursor?: string, options?: RequestOptions) {
    return this.connector.listResources(cursor, options);
  }

  /**
   * List all resources from the server, automatically handling pagination.
   *
   * @param options - Request options
   * @returns Complete list of all resources
   *
   * @example
   * ```typescript
   * const result = await session.listAllResources();
   * console.log(`Total resources: ${result.resources.length}`);
   * ```
   */
  async listAllResources(options?: RequestOptions) {
    return this.connector.listAllResources(options);
  }

  /**
   * List resource templates from the server.
   *
   * @param options - Request options
   * @returns List of available resource templates
   *
   * @example
   * ```typescript
   * const result = await session.listResourceTemplates();
   * console.log(`Available templates: ${result.resourceTemplates.length}`);
   * ```
   */
  async listResourceTemplates(options?: RequestOptions) {
    return this.connector.listResourceTemplates(options);
  }

  /**
   * Read a resource by URI.
   *
   * @param uri - URI of the resource to read
   * @param options - Request options
   * @returns Resource content
   *
   * @example
   * ```typescript
   * const resource = await session.readResource("file:///path/to/file.txt");
   * console.log(resource.contents);
   * ```
   */
  async readResource(uri: string, options?: RequestOptions) {
    return this.connector.readResource(uri, options);
  }

  /**
   * Subscribe to resource updates.
   *
   * @param uri - URI of the resource to subscribe to
   * @param options - Request options
   *
   * @example
   * ```typescript
   * await session.subscribeToResource("file:///path/to/file.txt");
   * // Now you'll receive notifications when this resource changes
   * ```
   */
  async subscribeToResource(uri: string, options?: RequestOptions) {
    return this.connector.subscribeToResource(uri, options);
  }

  /**
   * Unsubscribe from resource updates.
   *
   * @param uri - URI of the resource to unsubscribe from
   * @param options - Request options
   *
   * @example
   * ```typescript
   * await session.unsubscribeFromResource("file:///path/to/file.txt");
   * ```
   */
  async unsubscribeFromResource(uri: string, options?: RequestOptions) {
    return this.connector.unsubscribeFromResource(uri, options);
  }

  /**
   * List available prompts from the server.
   *
   * @returns List of available prompts
   *
   * @example
   * ```typescript
   * const result = await session.listPrompts();
   * console.log(`Available prompts: ${result.prompts.length}`);
   * ```
   */
  async listPrompts() {
    return this.connector.listPrompts();
  }

  /**
   * Get a specific prompt with arguments.
   *
   * @param name - Name of the prompt to get
   * @param args - Arguments for the prompt
   * @returns Prompt result
   *
   * @example
   * ```typescript
   * const prompt = await session.getPrompt("greeting", { name: "Alice" });
   * console.log(prompt.messages);
   * ```
   */
  async getPrompt(name: string, args: Record<string, any>) {
    return this.connector.getPrompt(name, args);
  }

  /**
   * Send a raw request through the client.
   *
   * @param method - MCP method name
   * @param params - Request parameters
   * @param options - Request options
   * @returns Response from the server
   *
   * @example
   * ```typescript
   * const result = await session.request("custom/method", { key: "value" });
   * ```
   */
  async request(
    method: string,
    params: Record<string, any> | null = null,
    options?: RequestOptions
  ) {
    return this.connector.request(method, params, options);
  }
}

// Re-export types for convenience
export type { CallToolResult, Notification, Root, Tool };
