import type {
  CallToolResult,
  Notification,
  Root,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { BaseConnector, NotificationHandler } from "./connectors/base.js";

/**
 * MCP Session for managing connections to MCP servers.
 *
 * An MCPSession represents a single connection to an MCP server. It wraps a
 * {@link BaseConnector} (Stdio, HTTP, or WebSocket) and provides high-level
 * methods for interacting with the server's tools, resources, and prompts.
 *
 * Sessions handle:
 * - Connection lifecycle (connect, disconnect, initialize)
 * - Tool invocation
 * - Resource access
 * - Prompt retrieval
 * - Notification handling
 * - Root directory management
 *
 * Sessions are typically created by {@link MCPClient.createSession} rather than
 * being instantiated directly.
 *
 * @example
 * ```typescript
 * // Create via client
 * const client = new MCPClient('./config.json');
 * const session = await client.createSession('my-server');
 *
 * // Use the session
 * const tools = await session.listTools();
 * const result = await session.callTool('my-tool', { arg: 'value' });
 * ```
 *
 * @example
 * ```typescript
 * // Manual creation (advanced)
 * import { StdioConnector } from 'mcp-use/client';
 *
 * const connector = new StdioConnector({
 *   command: 'node',
 *   args: ['server.js']
 * });
 * const session = new MCPSession(connector);
 * await session.initialize();
 * ```
 *
 * @see {@link MCPClient} for managing multiple sessions
 * @see {@link BaseConnector} for connector implementations
 */
export class MCPSession {
  /**
   * The underlying connector managing the transport layer.
   * This is the Stdio, HTTP, or WebSocket connector handling actual communication.
   */
  readonly connector: BaseConnector;

  /**
   * Whether to automatically connect when initializing.
   * @internal
   */
  private autoConnect: boolean;

  /**
   * Creates a new MCP session.
   *
   * @param connector - The connector to use for communication (Stdio, HTTP, WebSocket)
   * @param autoConnect - Whether to automatically connect during initialization (default: true)
   *
   * @example
   * ```typescript
   * const connector = new HttpConnector({ url: 'http://localhost:3000/mcp' });
   * const session = new MCPSession(connector);
   * await session.initialize(); // Auto-connects and initializes
   * ```
   *
   * @example
   * ```typescript
   * // Manual connection control
   * const session = new MCPSession(connector, false);
   * await session.connect();
   * await session.initialize();
   * ```
   */
  constructor(connector: BaseConnector, autoConnect = true) {
    this.connector = connector;
    this.autoConnect = autoConnect;
  }

  /**
   * Establishes the connection to the MCP server.
   *
   * This method starts the underlying transport (spawns process for Stdio,
   * opens WebSocket, etc.) but does not perform the MCP initialization
   * handshake. Call {@link initialize} after connecting.
   *
   * @returns Promise that resolves when connected
   *
   * @example
   * ```typescript
   * await session.connect();
   * await session.initialize();
   * ```
   *
   * @see {@link initialize} for performing the MCP handshake
   * @see {@link disconnect} for closing the connection
   */
  async connect(): Promise<void> {
    await this.connector.connect();
  }

  /**
   * Closes the connection to the MCP server.
   *
   * This method gracefully shuts down the transport and cleans up resources.
   * After disconnecting, the session cannot be used until reconnected.
   *
   * @returns Promise that resolves when disconnected
   *
   * @example
   * ```typescript
   * await session.disconnect();
   * console.log('Session closed');
   * ```
   *
   * @see {@link connect} for establishing connections
   */
  async disconnect(): Promise<void> {
    await this.connector.disconnect();
  }

  /**
   * Initializes the MCP session with the server.
   *
   * This method performs the MCP initialization handshake, exchanging
   * capabilities and metadata with the server. If `autoConnect` is true
   * and the session is not yet connected, it will connect first.
   *
   * After initialization, you can list and call tools, read resources, etc.
   *
   * @returns Promise that resolves when initialized
   *
   * @example
   * ```typescript
   * const session = await client.createSession('my-server', false);
   * await session.connect();
   * await session.initialize();
   * // Now ready to use
   * const tools = await session.listTools();
   * ```
   *
   * @see {@link connect} for establishing the connection first
   */
  async initialize(): Promise<void> {
    if (!this.isConnected && this.autoConnect) {
      await this.connect();
    }
    await this.connector.initialize();
  }

  /**
   * Checks if the session is currently connected to the server.
   *
   * @returns True if connected, false otherwise
   *
   * @example
   * ```typescript
   * if (session.isConnected) {
   *   const tools = await session.listTools();
   * }
   * ```
   */
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
   * Gets the current roots advertised to the server.
   *
   * Roots represent directories or files that the client has provided access to.
   * The server may use this information to scope its operations.
   *
   * @returns Array of Root objects
   *
   * @example
   * ```typescript
   * const roots = session.getRoots();
   * console.log(`Current roots: ${roots.map(r => r.uri).join(', ')}`);
   * ```
   *
   * @see {@link setRoots} for updating roots
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
