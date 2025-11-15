import type {
  Client,
  ClientOptions,
} from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionManager } from "../task_managers/base.js";
import { logger } from "../logging.js";

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
}

/**
 * Base class for MCP connectors.
 */
export abstract class BaseConnector {
  protected client: Client | null = null;
  protected connectionManager: ConnectionManager<any> | null = null;
  protected toolsCache: Tool[] | null = null;
  protected capabilitiesCache: any = null;
  protected serverInfoCache: { name: string; version?: string } | null = null;
  protected connected = false;
  protected readonly opts: ConnectorInitOptions;

  constructor(opts: ConnectorInitOptions = {}) {
    this.opts = opts;
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
    this.capabilitiesCache = capabilities;

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
  get serverCapabilities(): any {
    return this.capabilitiesCache;
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

    logger.debug(`Calling tool '${name}' with args`, args);
    const res = await this.client.callTool(
      { name, arguments: args },
      undefined,
      options
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
        const result = await this.client.listResources({ cursor }, options);
        allResources.push(...(result.resources || []));
        cursor = result.nextCursor;
      } while (cursor);

      return { resources: allResources };
    } catch (err: any) {
      // Gracefully handle if server advertises but doesn't actually support it
      if (err.code === -32601) {
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
    } catch (err: any) {
      // Gracefully handle if server advertises but doesn't actually support it
      if (err.code === -32601) {
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
