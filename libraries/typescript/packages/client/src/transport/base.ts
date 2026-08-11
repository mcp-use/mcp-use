import type {
  CallToolResult,
  Client,
  ClientOptions,
  CompleteRequestParams,
  CompleteResult,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
  AuthProvider,
  JSONRPCMessage,
  Notification,
  OAuthClientProvider,
  ProtocolEra,
  RequestOptions,
  Root,
  Tool,
} from "@modelcontextprotocol/client";
import { logger } from "../utils/logging.js";
import { isOAuthInteractionRequired } from "../auth/flow.js";
import type {
  SamplingCreateMessageParams,
  SamplingCreateMessageResult,
} from "../core/config.js";

/**
 * Accept-anything Standard Schema used for raw passthrough requests whose
 * method string is arbitrary (possibly non-spec). v2's `Protocol.request()`
 * requires a result schema for non-spec methods; this preserves the v1
 * "return whatever the server sent" behavior without importing Zod here.
 */
const passthroughResultSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "mcp-use",
    validate: (value: unknown) => ({ value }),
  },
};

import type { ConnectionManager } from "./connection-manager.js";
import type { ConnectorInitEventData } from "../telemetry/events.js";
import { trackConnectorTelemetry } from "../telemetry/connector-telemetry.js";
import type { MCPAuthorizationInfo, MCPServerInfo } from "../core/session.js";

/**
 * Handles a notification received from an MCP server.
 *
 * @param notification - Notification envelope supplied by the server.
 */
export type NotificationHandler = (
  notification: Notification
) => void | Promise<void>;

/** Shared initialization options for all connector transports. */
export interface ConnectorInitOptions {
  /**
   * Options forwarded to the underlying MCP `Client` instance.
   *
   * By default, all connectors (HTTP and stdio) use `DialectJsonSchemaValidator`
   * to support common `$schema` dialects (draft-04, draft-07, 2019-09, 2020-12)
   * for cross-version compatibility with v1-era servers. Override with
   * `clientOptions.jsonSchemaValidator` if stricter validation is needed.
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
  authProvider?: AuthProvider | OAuthClientProvider;
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
   *
   * @deprecated Sampling is deprecated by the 2026 protocol. Retained for v1
   * push requests and v2 multi-round-trip compatibility.
   */
  onSampling?: (
    params: SamplingCreateMessageParams
  ) => Promise<SamplingCreateMessageResult>;
  /**
   * Optional callback function to handle elicitation requests from servers.
   * When provided, the client will declare elicitation capability and handle
   * `elicitation/create` requests by calling this callback.
   *
   * Elicitation allows servers to request additional information from users:
   * - Form mode: Collect structured data with JSON schema validation
   * - URL mode: Direct users to external URLs for sensitive interactions
   */
  onElicitation?: (
    params: ElicitRequestFormParams | ElicitRequestURLParams
  ) => Promise<ElicitResult>;
  /**
   * Optional callback for server notifications.
   * When provided, registered as initial notification handler.
   */
  onNotification?: NotificationHandler;
  /**
   * Reconnection options for streamable HTTP transport.
   * Controls retry behavior of the underlying `StreamableHTTPClientTransport`.
   */
  reconnectionOptions?: {
    /** Maximum delay between reconnection attempts in milliseconds. */
    maxReconnectionDelay?: number;
    /** Delay before the first reconnection attempt in milliseconds. */
    initialReconnectionDelay?: number;
    /** Multiplier applied to the delay after each failed attempt. */
    reconnectionDelayGrowFactor?: number;
    /** Maximum number of reconnection attempts. */
    maxRetries?: number;
  };
}

/**
 * Implements protocol operations shared by MCP transport connectors.
 *
 * Subclasses provide transport-specific connection setup and a public
 * identifier. Call {@link BaseConnector.connect}, then
 * {@link BaseConnector.initialize}, before invoking protocol operations.
 */
export abstract class BaseConnector {
  protected client: Client | null = null;
  protected connectionManager: ConnectionManager<any> | null = null;
  protected toolsCache: Tool[] | null = null;
  protected capabilitiesCache: Record<string, unknown> | null = null;
  protected serverInfoCache: MCPServerInfo | null = null;
  protected authorizationCache: MCPAuthorizationInfo | undefined;
  protected connected = false;
  protected readonly opts: ConnectorInitOptions;
  protected notificationHandlers: NotificationHandler[] = [];
  protected rootsCache: Root[] = [];
  private activeProgressHandlers = new Set<
    NonNullable<RequestOptions["onprogress"]>
  >();

  /**
   * Creates a connector with shared SDK and callback options.
   *
   * @param opts - Connector initialization options.
   */
  constructor(opts: ConnectorInitOptions = {}) {
    this.opts = opts;
    // Initialize roots from options
    if (opts.roots) {
      this.rootsCache = [...opts.roots];
    }
    // Register initial notification handler if provided
    if (opts.onNotification) {
      this.notificationHandlers.push(opts.onNotification);
    }
  }

  /**
   * Track connector initialization event
   * Should be called by subclasses after successful connection
   */
  protected trackConnectorInit(
    data: Omit<ConnectorInitEventData, "connectorType">
  ): void {
    const connectorType = this.constructor.name;
    trackConnectorTelemetry({ connectorType, ...data });
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

  /** Forward a normalized notification to every registered consumer. */
  protected async forwardNotification(
    notification: Notification
  ): Promise<void> {
    for (const handler of this.notificationHandlers) {
      try {
        await handler(notification);
      } catch (err) {
        logger.error("Error in notification handler:", err);
      }
    }
  }

  /** Handle SDK list-change callbacks identically on v1 and v2 connections. */
  protected async handleListChanged(
    method:
      | "notifications/tools/list_changed"
      | "notifications/resources/list_changed"
      | "notifications/prompts/list_changed",
    error: Error | null,
    tools?: Tool[] | null
  ): Promise<void> {
    if (error) {
      logger.warn(`[Auto] ${method} refresh failed:`, error);
      return;
    }
    if (method === "notifications/tools/list_changed" && tools) {
      this.toolsCache = [...tools];
    }
    await this.forwardNotification({ method } as Notification);
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
          break;
      }

      await this.forwardNotification(notification);
    };

    // The SDK registers specific handlers for progress and cancelled notifications
    // that bypass fallbackNotificationHandler entirely. Override them to also
    // forward to user-registered handlers so they appear in notification UIs.
    const client = this.client as any;
    const handlersMap = client._notificationHandlers as Map<
      string,
      (notification: Notification) => Promise<void>
    >;

    for (const method of [
      "notifications/progress",
      "notifications/cancelled",
    ]) {
      const originalHandler = handlersMap.get(method);
      if (originalHandler) {
        handlersMap.set(method, async (notification: Notification) => {
          await originalHandler(notification);
          await this.forwardNotification(notification);
        });
      }
    }
  }

  /**
   * Forward v2 MRTR progress whose retry request IDs are not associated with
   * the original call callback by the current SDK beta.
   *
   * ponytail: fallback is enabled only when exactly one progress-aware call is
   * active; remove it when the upstream SDK propagates handlers to MRTR rounds.
   */
  protected setupRoundProgressForwarding(): void {
    if (!this.client) return;
    const sdkClient = this.client as unknown as {
      _onnotification: (message: JSONRPCMessage) => void | Promise<void>;
      _progressHandlers?: Map<unknown, unknown>;
    };
    const original = sdkClient._onnotification.bind(this.client);
    sdkClient._onnotification = async (message: JSONRPCMessage) => {
      if (
        message &&
        typeof message === "object" &&
        (message as { method?: unknown }).method === "notifications/progress"
      ) {
        this.forwardRoundProgress((message as { params?: unknown }).params);
      }
      await original?.(message);
    };
  }

  /** Forward progress parsed from a transport stream to the active call. */
  protected forwardRoundProgress(params: unknown): void {
    if (this.activeProgressHandlers.size === 1) {
      const [handler] = this.activeProgressHandlers;
      handler?.(
        params as Parameters<NonNullable<RequestOptions["onprogress"]>>[0]
      );
    }
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
   * @deprecated Roots are retained only for v1 compatibility.
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
   * Returns the roots currently advertised to the server.
   *
   * @returns A copy of the configured roots.
   */
  getRoots(): Root[] {
    return [...this.rootsCache];
  }

  /**
   * Internal: set up roots/list request handler.
   * Must be registered after Client construction and before connect() so the
   * handler is available during initialize / reverse RPC for the full session.
   */
  protected setupRootsHandler(): void {
    if (!this.client) return;

    // Handle roots/list requests from the server
    this.client.setRequestHandler("roots/list", async () => {
      logger.debug(
        `Server requested roots list, returning ${this.rootsCache.length} root(s)`
      );
      return { roots: this.rootsCache };
    });
  }

  /**
   * Internal: set up sampling/createMessage request handler.
   * Must be registered after Client construction and before connect().
   */
  protected setupSamplingHandler(): void {
    if (!this.client) {
      logger.debug("setupSamplingHandler: No client available");
      return;
    }
    const samplingCallback = this.opts.onSampling;
    if (!samplingCallback) {
      logger.debug("setupSamplingHandler: No sampling callback provided");
      return;
    }

    logger.debug("setupSamplingHandler: Setting up sampling request handler");
    // Handle sampling/createMessage requests from the server
    this.client.setRequestHandler("sampling/createMessage", async (request) => {
      logger.debug("Server requested sampling, forwarding to callback");
      return await samplingCallback(request.params);
    });
    logger.debug(
      "setupSamplingHandler: Sampling handler registered successfully"
    );
  }

  /**
   * Internal: set up elicitation/create request handler.
   * Must be registered after Client construction and before connect().
   */
  protected setupElicitationHandler(): void {
    if (!this.client) {
      logger.debug("setupElicitationHandler: No client available");
      return;
    }
    const elicitationCallback = this.opts.onElicitation;
    if (!elicitationCallback) {
      logger.debug("setupElicitationHandler: No elicitation callback provided");
      return;
    }

    logger.debug(
      "setupElicitationHandler: Setting up elicitation request handler"
    );
    // Handle elicitation/create requests from the server
    this.client.setRequestHandler("elicitation/create", async (request) => {
      logger.debug("Server requested elicitation, forwarding to callback");
      return await elicitationCallback(
        request.params as ElicitRequestFormParams | ElicitRequestURLParams
      );
    });
    logger.debug(
      "setupElicitationHandler: Elicitation handler registered successfully"
    );
  }

  /**
   * Establishes the transport connection and creates the SDK client.
   *
   * @returns A promise that resolves when the connector is connected.
   */
  abstract connect(): Promise<void>;

  /**
   * Returns transport-specific fields suitable for logs and telemetry.
   *
   * @returns A record identifying the connector without exposing credentials.
   */
  abstract get publicIdentifier(): Record<string, string>;

  /**
   * Run one logical MCP operation. HTTP connectors override this host seam to
   * finish an SDK-started interactive OAuth flow and retry exactly once.
   */
  protected async executeRequest<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  /** OAuth state discovered for the active connection, when available. */
  get authorization(): MCPAuthorizationInfo | undefined {
    return this.authorizationCache;
  }

  /**
   * Discover optional authorization metadata without delaying connection
   * readiness. HTTP connectors override this with RFC 9728 discovery.
   */
  async discoverAuthorization(): Promise<MCPAuthorizationInfo | undefined> {
    return this.authorization;
  }

  /** Start optional OAuth for a connected mixed-auth server. */
  async authenticate(): Promise<void> {
    throw new Error("This connector does not support interactive OAuth");
  }

  /**
   * Disconnects the SDK client and releases transport resources.
   *
   * @returns A promise that resolves after cleanup completes.
   */
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

  /** Whether an SDK client currently exists for this connector. */
  get isClientConnected(): boolean {
    return this.client != null;
  }

  /**
   * Initialise the MCP session **after** `connect()` has succeeded.
   *
   * In the SDK, `Client.connect(transport)` automatically performs the
   * protocol‑level `initialize` handshake, so we only need to cache the list of
   * tools and expose some server info.
   *
   * @param defaultRequestOptions - Options used while fetching the initial tool list.
   * @returns The capabilities advertised by the server.
   * @throws When {@link BaseConnector.connect} has not completed.
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

    // The SDK normalizes identity from legacy initialize responses and modern
    // result metadata. Modern servers may remain anonymous.
    const serverInfo = this.client.getServerVersion();
    this.serverInfoCache = serverInfo
      ? {
          name: serverInfo.name,
          version: serverInfo.version,
          title: serverInfo.title,
          description: serverInfo.description,
          websiteUrl: serverInfo.websiteUrl,
          icons: serverInfo.icons,
        }
      : null;

    // Fetch and cache tools
    // Gracefully handle servers that don't implement tools/list or have no tools
    try {
      const listToolsRes = await this.executeRequest(() =>
        this.client!.listTools(undefined, defaultRequestOptions)
      );
      this.toolsCache = (listToolsRes.tools ?? []) as Tool[];
      logger.debug(`Fetched ${this.toolsCache.length} tools from server`);
    } catch (err: unknown) {
      if (isOAuthInteractionRequired(err)) throw err;
      const error = err as Error & { code?: number };
      // If tools/list is not implemented or fails, assume no tools
      // This commonly happens with blank servers that have no tools registered
      if (error.code === -32601) {
        logger.debug("Server does not implement tools/list, assuming no tools");
      } else {
        logger.debug("Failed to list tools, assuming empty:", error.message);
      }
      this.toolsCache = [];
    }

    logger.debug("Server capabilities:", capabilities);
    logger.debug("Server info:", serverInfo);
    return capabilities;
  }

  /**
   * Returns the tool list cached during initialization.
   *
   * @throws When {@link BaseConnector.initialize} has not completed.
   */
  get tools(): Tool[] {
    if (!this.toolsCache) {
      throw new Error("MCP client is not initialized; call initialize() first");
    }
    return this.toolsCache;
  }

  /** Capabilities cached during initialization, or an empty object. */
  get serverCapabilities(): Record<string, unknown> {
    return this.capabilitiesCache || {};
  }

  /** Server identity cached during initialization, or `null`. */
  get serverInfo(): MCPServerInfo | null {
    return this.serverInfoCache;
  }

  /** Instructions supplied by the connected server, if any. */
  get instructions(): string | undefined {
    return this.client?.getInstructions?.();
  }

  /**
   * The negotiated protocol era for the active connection.
   * - `"legacy"` — 2025-era server, sessionful `initialize` handshake.
   * - `"modern"` — 2026-era server, stateless per-request.
   * `undefined` before the connection has negotiated.
   */
  get protocolEra(): ProtocolEra | undefined {
    return this.client?.getProtocolEra?.();
  }

  /** The protocol version string negotiated for the active connection. */
  get negotiatedProtocolVersion(): string | undefined {
    return this.client?.getNegotiatedProtocolVersion?.();
  }

  /**
   * Calls a tool on the connected server.
   *
   * @param name - Tool name.
   * @param args - Tool arguments.
   * @param options - Per-request timeout, cancellation, and progress options.
   * @returns The tool result returned by the server.
   * @throws When the connector is not connected or the tool call fails.
   */
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
    const progressHandler = enhancedOptions?.onprogress;
    if (progressHandler) this.activeProgressHandlers.add(progressHandler);
    try {
      const res = await this.executeRequest(() =>
        this.client!.callTool({ name, arguments: args }, enhancedOptions)
      );
      logger.debug(`Tool '${name}' returned`, res);
      return res as CallToolResult;
    } finally {
      if (progressHandler) this.activeProgressHandlers.delete(progressHandler);
    }
  }

  /**
   * List all available tools from the MCP server.
   * This method fetches fresh tools from the server, unlike the `tools` getter which returns cached tools.
   *
   * @param options - Optional request options
   * @returns Array of available tools
   */
  async listTools(options?: RequestOptions): Promise<Tool[]> {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }
    logger.debug("[listTools] Fetching fresh tools from server...");
    const result = await this.executeRequest(() =>
      this.client!.listTools(undefined, options)
    );
    // Create a new array to ensure React detects the change (avoid reference equality issues)
    const tools = result.tools ? [...result.tools] : [];
    logger.debug(
      `[listTools] Returned ${tools.length} tools:`,
      tools.map((t) => t.name)
    );
    return tools;
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
    return await this.executeRequest(() =>
      this.client!.listResources({ cursor }, options)
    );
  }

  /**
   * List all resources from the server, automatically handling pagination
   *
   * @param options - Request options
   * @returns Complete list of all resources
   */
  async listAllResources(options?: RequestOptions): Promise<{
    /** Resources returned across all result pages. */
    resources: any[];
  }> {
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
      return await this.executeRequest(async () => {
        const allResources: any[] = [];
        let cursor: string | undefined = undefined;

        do {
          const result: { resources?: any[]; nextCursor?: string } =
            await this.client!.listResources({ cursor }, options);
          allResources.push(...(result.resources || []));
          cursor = result.nextCursor;
        } while (cursor);

        return { resources: allResources };
      });
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
    return await this.executeRequest(() =>
      this.client!.listResourceTemplates(undefined, options)
    );
  }

  /**
   * Request completion suggestions for a prompt or resource template argument
   *
   * @param params - Completion request parameters
   * @param options - Request options
   * @returns Completion suggestions from the server
   */
  async complete(
    params: CompleteRequestParams,
    options?: RequestOptions
  ): Promise<CompleteResult> {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }
    logger.debug("[complete] Requesting completions for:", params.ref);
    const result = await this.executeRequest(() =>
      this.client!.complete(params, options)
    );
    logger.debug(
      `[complete] Received ${result.completion.values.length} suggestions`
    );
    return result;
  }

  /**
   * Reads a resource by URI.
   *
   * @param uri - Resource URI to read.
   * @param options - Per-request options.
   * @returns The resource contents returned by the server.
   */
  async readResource(uri: string, options?: RequestOptions) {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    logger.debug(`Reading resource ${uri}`);
    const res = await this.executeRequest(() =>
      this.client!.readResource({ uri }, options)
    );
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
    return await this.executeRequest(() =>
      this.client!.subscribeResource({ uri }, options)
    );
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
    return await this.executeRequest(() =>
      this.client!.unsubscribeResource({ uri }, options)
    );
  }

  /**
   * Lists prompts exposed by the server.
   *
   * @returns The prompt list, or an empty list when prompts are unsupported.
   */
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
      return await this.executeRequest(() => this.client!.listPrompts());
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

  /**
   * Gets a prompt with the supplied arguments.
   *
   * @param name - Prompt name.
   * @param args - Prompt arguments.
   * @returns The rendered prompt returned by the server.
   */
  async getPrompt(name: string, args: Record<string, any>) {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    logger.debug(`Getting prompt ${name}`);
    return await this.executeRequest(() =>
      this.client!.getPrompt({ name, arguments: args })
    );
  }

  /**
   * Sends a raw, potentially non-standard request through the SDK client.
   *
   * @param method - JSON-RPC method name.
   * @param params - Request parameters. Defaults to an empty object.
   * @param options - Per-request options.
   * @returns The unvalidated result returned by the server.
   */
  async request(
    method: string,
    params: Record<string, any> | null = null,
    options?: RequestOptions
  ) {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    logger.debug(`Sending raw request '${method}' with params`, params);
    // v2 requires a result schema for non-spec methods; a passthrough schema
    // preserves the v1 behavior of returning the raw server result for any
    // method string.
    return await this.executeRequest(() =>
      this.client!.request(
        { method, params: params ?? {} },
        passthroughResultSchema,
        options
      )
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
    this.authorizationCache = undefined;
    if (issues.length) {
      logger.warn(`Resource cleanup finished with ${issues.length} issue(s)`);
    }
  }
}
