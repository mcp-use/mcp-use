import type {
  Client,
  ClientOptions,
} from "@mcp-use/modelcontextprotocol-sdk/client/index.js";
import type { RequestOptions } from "@mcp-use/modelcontextprotocol-sdk/shared/protocol.js";
import {
  ListRootsRequestSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
} from "@mcp-use/modelcontextprotocol-sdk/types.js";
import type {
  CallToolResult,
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
  Notification,
  Root,
  Tool,
} from "@mcp-use/modelcontextprotocol-sdk/types.js";
import type { ConnectionManager } from "../task_managers/base.js";
import { logger } from "../logging.js";

/**
 * Handler function for server notifications
 */
export type NotificationHandler = (
  notification: Notification
) => void | Promise<void>;

export interface ConnectorInitOptions {
  /**
   * Options forwarded to the underlying MCP `Client` instance.
   */
  clientOptions?: ClientOptions;
  /**
   * Arbitrary request options (timeouts, cancellation, etc.) used by helper
   * methods when they issue SDK requests. Can be overridden per‑call.
   */
  defaultRequestOptions?: RequestOptions;
  /**
   * OAuth client provider for automatic authentication
   */
  authProvider?: any;
  /**
   * Optional callback to wrap the transport before passing it to the Client.
   * Useful for logging, monitoring, or other transport-level interceptors.
   */
  wrapTransport?: (transport: any, serverId: string) => any;
  /**
   * Initial roots to provide to the server.
   * Roots allow the server to know which directories/files the client has access to.
   */
  roots?: Root[];
  /**
   * Optional callback function to handle sampling requests from servers.
   * When provided, the client will declare sampling capability and handle
   * `sampling/createMessage` requests by calling this callback.
   */
  samplingCallback?: (
    params: CreateMessageRequest["params"]
  ) => Promise<CreateMessageResult>;
  /**
   * Optional callback function to handle elicitation requests from servers.
   * When provided, the client will declare elicitation capability and handle
   * `elicitation/create` requests by calling this callback.
   *
   * Elicitation allows servers to request additional information from users:
   * - Form mode: Collect structured data with JSON schema validation
   * - URL mode: Direct users to external URLs for sensitive interactions
   */
  elicitationCallback?: (
    params: ElicitRequestFormParams | ElicitRequestURLParams
  ) => Promise<ElicitResult>;
}

/**
 * Base class for MCP connectors.
 */
export abstract class BaseConnector {
  protected client: Client | null = null;
  protected connectionManager: ConnectionManager<any> | null = null;
  protected toolsCache: Tool[] | null = null;
  protected capabilitiesCache: Record<string, unknown> | null = null;
  protected serverInfoCache: { name: string; version?: string } | null = null;
  protected connected = false;
  protected readonly opts: ConnectorInitOptions;
  protected notificationHandlers: NotificationHandler[] = [];
  protected rootsCache: Root[] = [];

  constructor(opts: ConnectorInitOptions = {}) {
    this.opts = opts;
    // Initialize roots from options
    if (opts.roots) {
      this.rootsCache = [...opts.roots];
    }
  }

  /**
   * Register a handler for server notifications
   *
   * @param handler - Function to call when a notification is received
   *
   * @example
   * ```typescript
   * connector.onNotification((notification) => {
   *   console.log(`Received: ${notification.method}`, notification.params);
   * });
   * ```
   */
  onNotification(handler: NotificationHandler): void {
    this.notificationHandlers.push(handler);
    // Wire up to SDK client if already connected
    if (this.client) {
      this.setupNotificationHandler();
    }
  }

  /**
   * Internal: wire notification handlers to the SDK client
   * Includes automatic handling for list_changed notifications per MCP spec
   */
  protected setupNotificationHandler(): void {
    if (!this.client) return;

    // Use fallbackNotificationHandler to catch all notifications
    this.client.fallbackNotificationHandler = async (
      notification: Notification
    ) => {
      // Auto-handle list_changed notifications per MCP spec
      // Clients SHOULD re-fetch the list when receiving these notifications
      switch (notification.method) {
        case "notifications/tools/list_changed":
          await this.refreshToolsCache();
          break;
        case "notifications/resources/list_changed":
          await this.onResourcesListChanged();
          break;
        case "notifications/prompts/list_changed":
          await this.onPromptsListChanged();
          break;
        default:
          // Other notification methods are handled by user-registered handlers
          break;
      }

      // Then call user-registered handlers
      for (const handler of this.notificationHandlers) {
        try {
          await handler(notification);
        } catch (err) {
          logger.error("Error in notification handler:", err);
        }
      }
    };
  }

  /**
   * Auto-refresh tools cache when server sends tools/list_changed notification
   */
  protected async refreshToolsCache(): Promise<void> {
    if (!this.client) return;
    try {
      logger.debug(
        "[Auto] Refreshing tools cache due to list_changed notification"
      );
      const result = await this.client.listTools();
      this.toolsCache = (result.tools ?? []) as Tool[];
      logger.debug(
        `[Auto] Refreshed tools cache: ${this.toolsCache.length} tools`
      );
    } catch (err) {
      logger.warn("[Auto] Failed to refresh tools cache:", err);
    }
  }

  /**
   * Called when server sends resources/list_changed notification
   * Resources aren't cached by default, but we log for user awareness
   */
  protected async onResourcesListChanged(): Promise<void> {
    logger.debug(
      "[Auto] Resources list changed - clients should re-fetch if needed"
    );
  }

  /**
   * Called when server sends prompts/list_changed notification
   * Prompts aren't cached by default, but we log for user awareness
   */
  protected async onPromptsListChanged(): Promise<void> {
    logger.debug(
      "[Auto] Prompts list changed - clients should re-fetch if needed"
    );
  }

  /**
   * Set roots and notify the server.
   * Roots represent directories or files that the client has access to.
   *
   * @param roots - Array of Root objects with `uri` (must start with "file://") and optional `name`
   *
   * @example
   * ```typescript
   * await connector.setRoots([
   *   { uri: "file:///home/user/project", name: "My Project" },
   *   { uri: "file:///home/user/data" }
   * ]);
   * ```
   */
  async setRoots(roots: Root[]): Promise<void> {
    this.rootsCache = [...roots];
    if (this.client) {
      logger.debug(
        `Sending roots/list_changed notification with ${roots.length} root(s)`
      );
      await this.client.sendRootsListChanged();
    }
  }

  /**
   * Get the current roots.
   */
  getRoots(): Root[] {
    return [...this.rootsCache];
  }

  /**
   * Internal: set up roots/list request handler.
   * This is called after the client connects to register the handler for server requests.
   */
  protected setupRootsHandler(): void {
    if (!this.client) return;

    // Handle roots/list requests from the server
    this.client.setRequestHandler(
      ListRootsRequestSchema,
      async (_request: unknown, _extra: unknown) => {
        logger.debug(
          `Server requested roots list, returning ${this.rootsCache.length} root(s)`
        );
        return { roots: this.rootsCache };
      }
    );
  }

  /**
   * Internal: set up sampling/createMessage request handler.
   * This is called after the client connects to register the handler for sampling requests.
   */
  protected setupSamplingHandler(): void {
    if (!this.client) {
      logger.debug("setupSamplingHandler: No client available");
      return;
    }
    if (!this.opts.samplingCallback) {
      logger.debug("setupSamplingHandler: No sampling callback provided");
      return;
    }

    logger.debug("setupSamplingHandler: Setting up sampling request handler");
    // Handle sampling/createMessage requests from the server
    this.client.setRequestHandler(
      CreateMessageRequestSchema,
      async (request: CreateMessageRequest, _extra: unknown) => {
        logger.debug("Server requested sampling, forwarding to callback");
        return await this.opts.samplingCallback!(request.params);
      }
    );
    logger.debug(
      "setupSamplingHandler: Sampling handler registered successfully"
    );
  }

  /**
   * Internal: set up elicitation/create request handler.
   * This is called after the client connects to register the handler for elicitation requests.
   */
  protected setupElicitationHandler(): void {
    if (!this.client) {
      logger.debug("setupElicitationHandler: No client available");
      return;
    }
    if (!this.opts.elicitationCallback) {
      logger.debug("setupElicitationHandler: No elicitation callback provided");
      return;
    }

    logger.debug(
      "setupElicitationHandler: Setting up elicitation request handler"
    );
    // Handle elicitation/create requests from the server
    this.client.setRequestHandler(
      ElicitRequestSchema,
      async (
        request: { params: ElicitRequestFormParams | ElicitRequestURLParams },
        _extra: unknown
      ) => {
        logger.debug("Server requested elicitation, forwarding to callback");
        return await this.opts.elicitationCallback!(request.params);
      }
    );
    logger.debug(
      "setupElicitationHandler: Elicitation handler registered successfully"
    );
  }

  /** Establish the connection and create the SDK client. */
  abstract connect(): Promise<void>;

  /** Get the identifier for the connector. */
  abstract get publicIdentifier(): Record<string, string>;

  /** Disconnect and release resources. */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      logger.debug("Not connected to MCP implementation");
      return;
    }

    logger.debug("Disconnecting from MCP implementation");
    await this.cleanupResources();
    this.connected = false;
    logger.debug("Disconnected from MCP implementation");
  }

  /** Check if the client is connected */
  get isClientConnected(): boolean {
    return this.client != null;
  }

  /**
   * Initialise the MCP session **after** `connect()` has succeeded.
   *
   * In the SDK, `Client.connect(transport)` automatically performs the
   * protocol‑level `initialize` handshake, so we only need to cache the list of
   * tools and expose some server info.
   */
  async initialize(
    defaultRequestOptions: RequestOptions = this.opts.defaultRequestOptions ??
      {}
  ): Promise<ReturnType<Client["getServerCapabilities"]>> {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    logger.debug("Caching server capabilities & tools");

    // Cache server capabilities for callers who need them.
    const capabilities = this.client.getServerCapabilities();
    this.capabilitiesCache = (capabilities as Record<string, unknown>) || null;

    // Cache server info from the initialize response
    const serverInfo = this.client.getServerVersion();
    this.serverInfoCache = serverInfo || null;

    // Fetch and cache tools
    const listToolsRes = await this.client.listTools(
      undefined,
      defaultRequestOptions
    );
    this.toolsCache = (listToolsRes.tools ?? []) as Tool[];

    logger.debug(`Fetched ${this.toolsCache.length} tools from server`);
    logger.debug("Server capabilities:", capabilities);
    logger.debug("Server info:", serverInfo);
    return capabilities;
  }

  /** Lazily expose the cached tools list. */
  get tools(): Tool[] {
    if (!this.toolsCache) {
      throw new Error("MCP client is not initialized; call initialize() first");
    }
    return this.toolsCache;
  }

  /** Expose cached server capabilities. */
  get serverCapabilities(): Record<string, unknown> {
    return this.capabilitiesCache || {};
  }

  /** Expose cached server info. */
  get serverInfo(): { name: string; version?: string } | null {
    return this.serverInfoCache;
  }

  /** Call a tool on the server. */
  async callTool(
    name: string,
    args: Record<string, any>,
    options?: RequestOptions
  ): Promise<CallToolResult> {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    // If resetTimeoutOnProgress is enabled but no onprogress callback is provided,
    // add a no-op callback to trigger the SDK to add progressToken to the request.
    // The SDK only adds progressToken when onprogress is present, which is required
    // for the server to send progress notifications that reset the timeout.
    const enhancedOptions = options ? { ...options } : undefined;
    if (
      enhancedOptions?.resetTimeoutOnProgress &&
      !enhancedOptions.onprogress
    ) {
      // Add no-op progress callback to trigger progressToken addition
      enhancedOptions.onprogress = () => {
        // No-op: progress notifications are handled by the SDK's timeout reset logic
      };
      logger.debug(
        `[BaseConnector] Added onprogress callback for tool '${name}' to enable progressToken`
      );
    }

    logger.debug(`Calling tool '${name}' with args`, args);
    const res = await this.client.callTool(
      { name, arguments: args },
      undefined,
      enhancedOptions
    );
    logger.debug(`Tool '${name}' returned`, res);
    return res as CallToolResult;
  }

  /**
   * List resources from the server with optional pagination
   *
   * @param cursor - Optional cursor for pagination
   * @param options - Request options
   * @returns Resource list with optional nextCursor for pagination
   */
  async listResources(cursor?: string, options?: RequestOptions) {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    logger.debug("Listing resources", cursor ? `with cursor: ${cursor}` : "");
    return await this.client.listResources({ cursor }, options);
  }

  /**
   * List all resources from the server, automatically handling pagination
   *
   * @param options - Request options
   * @returns Complete list of all resources
   */
  async listAllResources(options?: RequestOptions) {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    // Check if server advertises resources capability
    if (!this.capabilitiesCache?.resources) {
      logger.debug("Server does not advertise resources capability, skipping");
      return { resources: [] };
    }

    try {
      logger.debug("Listing all resources (with auto-pagination)");
      const allResources: any[] = [];
      let cursor: string | undefined = undefined;

      do {
        const result: { resources?: any[]; nextCursor?: string } =
          await this.client.listResources({ cursor }, options);
        allResources.push(...(result.resources || []));
        cursor = result.nextCursor;
      } while (cursor);

      return { resources: allResources };
    } catch (err: unknown) {
      const error = err as Error & { code?: number };
      // Gracefully handle if server advertises but doesn't actually support it
      if (error.code === -32601) {
        logger.debug("Server advertised resources but method not found");
        return { resources: [] };
      }
      throw err;
    }
  }

  /**
   * List resource templates from the server
   *
   * @param options - Request options
   * @returns List of available resource templates
   */
  async listResourceTemplates(options?: RequestOptions) {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    logger.debug("Listing resource templates");
    return await this.client.listResourceTemplates(undefined, options);
  }

  /** Read a resource by URI. */
  async readResource(uri: string, options?: RequestOptions) {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    logger.debug(`Reading resource ${uri}`);
    const res = await this.client.readResource({ uri }, options);
    return res;
  }

  /**
   * Subscribe to resource updates
   *
   * @param uri - URI of the resource to subscribe to
   * @param options - Request options
   */
  async subscribeToResource(uri: string, options?: RequestOptions) {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    logger.debug(`Subscribing to resource: ${uri}`);
    return await this.client.subscribeResource({ uri }, options);
  }

  /**
   * Unsubscribe from resource updates
   *
   * @param uri - URI of the resource to unsubscribe from
   * @param options - Request options
   */
  async unsubscribeFromResource(uri: string, options?: RequestOptions) {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    logger.debug(`Unsubscribing from resource: ${uri}`);
    return await this.client.unsubscribeResource({ uri }, options);
  }

  async listPrompts() {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    // Check if server advertises prompts capability
    if (!this.capabilitiesCache?.prompts) {
      logger.debug("Server does not advertise prompts capability, skipping");
      return { prompts: [] };
    }

    try {
      logger.debug("Listing prompts");
      return await this.client.listPrompts();
    } catch (err: unknown) {
      const error = err as Error & { code?: number };
      // Gracefully handle if server advertises but doesn't actually support it
      if (error.code === -32601) {
        logger.debug("Server advertised prompts but method not found");
        return { prompts: [] };
      }
      throw err;
    }
  }

  async getPrompt(name: string, args: Record<string, any>) {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    logger.debug(`Getting prompt ${name}`);
    return await this.client.getPrompt({ name, arguments: args });
  }

  /** Send a raw request through the client. */
  async request(
    method: string,
    params: Record<string, any> | null = null,
    options?: RequestOptions
  ) {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    logger.debug(`Sending raw request '${method}' with params`, params);
    return await this.client.request(
      { method, params: params ?? {} },
      undefined as any,
      options
    );
  }

  /**
   * Helper to tear down the client & connection manager safely.
   */
  protected async cleanupResources(): Promise<void> {
    const issues: string[] = [];

    if (this.client) {
      try {
        if (typeof this.client.close === "function") {
          await this.client.close();
        }
      } catch (e) {
        const msg = `Error closing client: ${e}`;
        logger.warn(msg);
        issues.push(msg);
      } finally {
        this.client = null;
      }
    }

    if (this.connectionManager) {
      try {
        await this.connectionManager.stop();
      } catch (e) {
        const msg = `Error stopping connection manager: ${e}`;
        logger.warn(msg);
        issues.push(msg);
      } finally {
        this.connectionManager = null;
      }
    }

    this.toolsCache = null;
    if (issues.length) {
      logger.warn(`Resource cleanup finished with ${issues.length} issue(s)`);
    }
  }
}
