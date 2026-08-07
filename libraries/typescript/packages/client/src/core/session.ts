import type {
  CallToolResult,
  CompleteRequestParams,
  CompleteResult,
  MetaObject,
  Notification,
  ProtocolEra,
  RequestOptions,
  Root,
  Tool,
} from "@modelcontextprotocol/client";
import type { BaseConnector, NotificationHandler } from "../transport/base.js";

/** Negotiated protocol era: `"legacy"` or `"modern"`. */
export type MCPProtocolEra = ProtocolEra;

/** OAuth availability inferred after an anonymous MCP connection succeeds. */
export interface MCPAuthorizationInfo {
  /** Mixed auth means public MCP operations succeeded while OAuth is available. */
  mode: "mixed";
  /** Whether this client currently has OAuth access tokens. */
  authenticated: boolean;
  /** Canonical protected-resource identifier from RFC 9728 metadata. */
  resource?: string;
  /** Scopes advertised by the protected resource, when provided. */
  scopesSupported?: string[];
}

/**
 * Server information normalized across legacy sessionful and modern sessionless
 * MCP protocols.
 */
export interface MCPServerInfo {
  /** Stable server name. */
  name: string;
  /** Server version reported during initialization. */
  version?: string;
  /** Optional human-readable server title. */
  title?: string;
  /** Optional human-readable server description. */
  description?: string;
  /** Public website describing the server. */
  websiteUrl?: string;
  /** Icons advertised by the server. */
  icons?: Array<{
    /** Icon URL. */
    src: string;
    /** Icon media type. */
    mimeType?: string;
    /** Supported icon sizes, such as `"48x48"`. */
    sizes?: string[];
  }>;
}

/**
 * Connection metadata available after the MCP SDK has negotiated a protocol.
 *
 * `extensions` retains protocol-specific extensions without requiring
 * callers to branch on the negotiated era.
 */
export interface MCPConnectionInfo {
  /** Negotiated protocol era. */
  protocolEra: MCPProtocolEra;
  /** Negotiated MCP protocol version. */
  protocolVersion: string;
  /** Server identity reported during negotiation, when provided. */
  server?: MCPServerInfo;
  /** Capabilities advertised by the server. */
  capabilities: Record<string, unknown>;
  /** Instructions advertised by the server. */
  instructions?: string;
  /** Protocol extension metadata advertised by the server. */
  extensions: Record<string, unknown>;
  /** Optional OAuth state discovered without forcing authentication. */
  authorization?: MCPAuthorizationInfo;
}

/**
 * A ready connection to an MCP server.
 *
 * The connection has the same public API for legacy, sessionful MCP servers
 * and modern, sessionless MCP servers. The underlying SDK owns the lifecycle
 * distinction and protocol negotiation.
 *
 * Sessions handle:
 * - Connection lifecycle (connect, disconnect, initialize)
 * - Tool invocation
 * - Resource access
 * - Prompt retrieval
 * - Notification handling
 * - Root directory management
 *
 * Sessions are typically created by `MCPClient.createSession()` rather than
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
 * import { StdioConnector } from "@mcp-use/client";
 *
 * const connector = new StdioConnector({
 *   command: 'node',
 *   args: ['server.js']
 * });
 * const session = new MCPSession(connector);
 * await session.initialize();
 * ```
 *
 * @see {@link BaseConnector} for connector implementations
 */
export class MCPConnection {
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
   * @deprecated Roots are a v1 compatibility feature and are not part of the
   * sessionless v2 protocol.
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
  get serverInfo(): MCPServerInfo | null {
    return this.connector.serverInfo;
  }

  /** OAuth state discovered for this connection, when available. */
  get authorization(): MCPAuthorizationInfo | undefined {
    return this.connector.authorization;
  }

  /** Authenticate an already-connected mixed-auth server. */
  async authenticate(): Promise<void> {
    await this.connector.authenticate();
  }

  /**
   * The negotiated protocol era for this session's connection:
   * `"legacy"` (2025-era) or `"modern"` (2026-07-28-era).
   * `undefined` before the connection has negotiated.
   */
  get protocolEra(): MCPProtocolEra | undefined {
    return this.connector.protocolEra;
  }

  /** The negotiated protocol version string for this session's connection. */
  get negotiatedProtocolVersion(): string | undefined {
    return this.connector.negotiatedProtocolVersion;
  }

  /**
   * Normalized server metadata for this ready connection.
   *
   * @throws When called before protocol negotiation completes.
   */
  get info(): MCPConnectionInfo {
    const protocolEra = this.protocolEra;
    const protocolVersion = this.negotiatedProtocolVersion;
    const server = this.serverInfo;

    if (!protocolEra || !protocolVersion) {
      throw new Error("MCP connection is not initialized");
    }

    const capabilities = this.serverCapabilities;
    const extensions =
      capabilities.extensions &&
      typeof capabilities.extensions === "object" &&
      !Array.isArray(capabilities.extensions)
        ? (capabilities.extensions as Record<string, unknown>)
        : {};

    return {
      protocolEra,
      protocolVersion,
      ...(server ? { server } : {}),
      capabilities,
      instructions: this.connector.instructions,
      extensions,
      ...(this.authorization ? { authorization: this.authorization } : {}),
    };
  }

  /**
   * Whether the server advertised a named MCP capability.
   *
   * @param capability - A top-level capability name such as `"tools"` or
   * `"resources"`.
   */
  supports(capability: string): boolean {
    return capability in this.serverCapabilities;
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
   * Request completion suggestions for a prompt or resource template argument.
   *
   * @param params - Completion request parameters
   * @param options - Request options
   * @returns Completion suggestions from the server
   *
   * @example
   * ```typescript
   * // Complete a prompt argument
   * const result = await session.complete({
   *   ref: { type: "ref/prompt", name: "my-prompt" },
   *   argument: { name: "language", value: "py" }
   * });
   * console.log(result.completion.values); // ["python"]
   * ```
   */
  async complete(
    params: CompleteRequestParams,
    options?: RequestOptions
  ): Promise<CompleteResult> {
    return this.connector.complete(params, options);
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

  /** List one page of skills advertised through the experimental extension. */
  async listSkills(cursor?: string, options?: RequestOptions) {
    return (await this.request(
      "skills/list",
      cursor === undefined ? {} : { cursor },
      options
    )) as import("./skills.js").SkillsListResult;
  }

  /** List the complete skill catalog, following pagination defensively. */
  async listAllSkills(options?: RequestOptions) {
    const skills: import("./skills.js").Skill[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.listSkills(cursor, options);
      skills.push(...(Array.isArray(page.skills) ? page.skills : []));
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new Error("skills/list returned a repeated pagination cursor");
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);
    return { skills };
  }

  /** Get one skill by its canonical `SKILL.md` URI. */
  async getSkill(uri: string, options?: RequestOptions) {
    return (await this.request(
      "skills/get",
      { uri },
      options
    )) as import("./skills.js").SkillGetResult;
  }

  /** Read one non-recursive skill directory. */
  async readResourceDirectory(
    uri: string,
    cursor?: string,
    options?: RequestOptions
  ) {
    return (await this.request(
      "resources/directory/read",
      cursor === undefined ? { uri } : { uri, cursor },
      options
    )) as import("./skills.js").SkillDirectoryReadResult;
  }
}

/** @deprecated Use {@link MCPConnection}. */
export { MCPConnection as MCPSession };

// Re-export types for convenience
export type { CallToolResult, MetaObject, Notification, Root, Tool };
export type {
  Skill,
  SkillDirectoryEntry,
  SkillDirectoryReadResult,
  SkillGetResult,
  SkillResource,
  SkillsListResult,
} from "./skills.js";
export { SKILLS_EXTENSION_ID } from "./skills.js";
