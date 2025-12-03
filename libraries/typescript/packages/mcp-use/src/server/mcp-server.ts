import { McpServer as OfficialMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Hono as HonoType } from "hono";

import { uiResourceRegistration, mountWidgets } from "./widgets/index.js";
import { mountInspectorUI } from "./inspector/index.js";
import {
  toolRegistration,
  convertZodSchemaToParams,
  createParamsSchema,
} from "./tools/index.js";
import {
  registerResource,
  registerResourceTemplate,
} from "./resources/index.js";
import { registerPrompt } from "./prompts/index.js";

// Import and re-export tool context types for public API
import type {
  ToolContext,
  SampleOptions,
  ElicitOptions,
  ElicitFormParams,
  ElicitUrlParams,
} from "./types/tool-context.js";

export type {
  ToolContext,
  SampleOptions,
  ElicitOptions,
  ElicitFormParams,
  ElicitUrlParams,
};

import { onRootsChanged, listRoots } from "./roots/index.js";
import { requestLogger } from "./logging.js";
import type { SessionData } from "./sessions/index.js";
import {
  getActiveSessions,
  sendNotification,
  sendNotificationToSession,
} from "./notifications/index.js";
import { mountMcp as mountMcpHelper } from "./endpoints/index.js";
import type { ServerConfig } from "./types/index.js";
import {
  getEnv,
  getServerBaseUrl as getServerBaseUrlHelper,
  logRegisteredItems as logRegisteredItemsHelper,
  startServer,
  rewriteSupabaseRequest,
  createHonoApp,
  createHonoProxy,
  isProductionMode as isProductionModeHelper,
} from "./utils/index.js";
import { setupOAuthForServer } from "./oauth/setup.js";

export class McpServer {
  protected server: OfficialMcpServer;
  private config: ServerConfig;
  public app: HonoType;
  private mcpMounted = false;
  private inspectorMounted = false;
  protected serverPort?: number;
  protected serverHost: string;
  protected serverBaseUrl?: string;
  protected registeredTools: string[] = [];
  private registeredPrompts: string[] = [];
  private registeredResources: string[] = [];
  protected buildId?: string;
  private sessions = new Map<string, SessionData>();
  private idleCleanupInterval?: NodeJS.Timeout;
  private oauthConfig?: any; // Store OAuth config for lazy initialization
  private oauthSetupState = {
    complete: false,
    provider: undefined,
    middleware: undefined,
  };
  private oauthProvider?: any;
  private oauthMiddleware?: any;

  /**
   * Creates a new MCP server instance with Hono integration
   *
   * Initializes the server with the provided configuration, sets up CORS headers,
   * configures widget serving routes, and creates a proxy that allows direct
   * access to Hono methods while preserving MCP server functionality.
   *
   * @param config - Server configuration including name, version, and description
   * @returns A proxied McpServer instance that supports both MCP and Hono methods
   */
  constructor(config: ServerConfig) {
    this.config = config;
    this.serverHost = config.host || "localhost";
    this.serverBaseUrl = config.baseUrl;
    this.server = new OfficialMcpServer({
      name: config.name,
      version: config.version,
    });

    // Create and configure Hono app with default middleware
    this.app = createHonoApp(requestLogger);

    // Store OAuth config for lazy initialization (will be setup in listen/getHandler)
    if (config.oauth) {
      this.oauthConfig = config.oauth;
    }

    // Return proxied instance that allows direct access to Hono methods
    return createHonoProxy(this, this.app);
  }

  /**
   * Gets the server base URL with fallback to host:port if not configured
   * @returns The complete base URL for the server
   */
  private getServerBaseUrl(): string {
    return getServerBaseUrlHelper(
      this.serverBaseUrl,
      this.serverHost,
      this.serverPort
    );
  }

  // Tool registration helper
  public tool = toolRegistration;

  // Schema conversion helpers (used by tool registration)
  public convertZodSchemaToParams = convertZodSchemaToParams;
  public createParamsSchema = createParamsSchema;

  // Resource registration helpers
  public resource = registerResource;
  public resourceTemplate = registerResourceTemplate;

  // Prompt registration helper
  public prompt = registerPrompt;

  // Notification helpers
  public getActiveSessions = getActiveSessions;
  public sendNotification = sendNotification;
  public sendNotificationToSession = sendNotificationToSession;

  public uiResource = uiResourceRegistration as any;

  /**
   * Mount MCP server endpoints at /mcp and /sse
   *
   * Sets up the HTTP transport layer for the MCP server, creating endpoints for
   * Server-Sent Events (SSE) streaming, POST message handling, and DELETE session cleanup.
   * Transports are reused per session ID to maintain state across requests.
   *
   * This method is called automatically when the server starts listening and ensures
   * that MCP clients can communicate with the server over HTTP.
   *
   * @private
   * @returns Promise that resolves when MCP endpoints are successfully mounted
   *
   * @example
   * Endpoints created:
   * - GET /mcp, GET /sse - SSE streaming endpoint for real-time communication
   * - POST /mcp, POST /sse - Message handling endpoint for MCP protocol messages
   * - DELETE /mcp, DELETE /sse - Session cleanup endpoint
   */
  private async mountMcp(): Promise<void> {
    if (this.mcpMounted) return;

    const result = await mountMcpHelper(
      this.app,
      this.server,
      this.sessions,
      this.config,
      isProductionModeHelper()
    );

    this.mcpMounted = result.mcpMounted;
    if (result.idleCleanupInterval) {
      this.idleCleanupInterval = result.idleCleanupInterval;
    }
  }

  /**
   * Start the Hono server with MCP endpoints
   *
   * Initiates the server startup process by mounting MCP endpoints, configuring
   * the inspector UI (if available), and starting the server to listen
   * for incoming connections. This is the main entry point for running the server.
   *
   * The server will be accessible at the specified port with MCP endpoints at /mcp and /sse
   * and inspector UI at /inspector (if the inspector package is installed).
   *
   * @param port - Port number to listen on (defaults to 3001 if not specified)
   * @returns Promise that resolves when the server is successfully listening
   *
   * @example
   * ```typescript
   * await server.listen(8080)
   * // Server now running at http://localhost:8080 (or configured host)
   * // MCP endpoints: http://localhost:8080/mcp and http://localhost:8080/sse
   * // Inspector UI: http://localhost:8080/inspector
   * ```
   */
  /**
   * Log registered tools, prompts, and resources to console
   */
  private logRegisteredItems(): void {
    logRegisteredItemsHelper(
      this.registeredTools,
      this.registeredPrompts,
      this.registeredResources
    );
  }

  public getBuildId() {
    return this.buildId;
  }

  public getServerPort() {
    return this.serverPort || 3000;
  }

  async listen(port?: number): Promise<void> {
    // Priority: parameter > PORT env var > default (3001)
    const portEnv = getEnv("PORT");
    this.serverPort = port || (portEnv ? parseInt(portEnv, 10) : 3001);

    // Update host from HOST env var if set
    const hostEnv = getEnv("HOST");
    if (hostEnv) {
      this.serverHost = hostEnv;
    }

    // Setup OAuth before mounting widgets/MCP (if configured)
    if (this.oauthConfig && !this.oauthSetupState.complete) {
      await setupOAuthForServer(
        this.app,
        this.oauthProvider,
        this.getServerBaseUrl(),
        this.oauthSetupState
      );
    }

    await mountWidgets(this, {
      baseRoute: "/mcp-use/widgets",
      resourcesDir: "resources",
    });
    await this.mountMcp();

    // Mount inspector BEFORE Vite middleware to ensure it handles /inspector routes
    await this.mountInspector();

    // Log registered items before starting server
    this.logRegisteredItems();

    // Start server using runtime-aware helper
    await startServer(this.app, this.serverPort, this.serverHost, {
      onDenoRequest: rewriteSupabaseRequest,
    });
  }

  /**
   * Get the fetch handler for the server after mounting all endpoints
   *
   * This method prepares the server by mounting MCP endpoints, widgets, and inspector
   * (if available), then returns the fetch handler. This is useful for integrating
   * with external server frameworks like Supabase Edge Functions, Cloudflare Workers,
   * or other platforms that handle the server lifecycle themselves.
   *
   * Unlike `listen()`, this method does not start a server - it only prepares the
   * routes and returns the handler function that can be used with external servers.
   *
   * @param options - Optional configuration for the handler
   * @param options.provider - Platform provider (e.g., 'supabase') to handle platform-specific path rewriting
   * @returns Promise that resolves to the fetch handler function
   *
   * @example
   * ```typescript
   * // For Supabase Edge Functions (handles path rewriting automatically)
   * const server = createMCPServer('my-server');
   * server.tool({ ... });
   * const handler = await server.getHandler({ provider: 'supabase' });
   * Deno.serve(handler);
   * ```
   *
   * @example
   * ```typescript
   * // For Cloudflare Workers
   * const server = createMCPServer('my-server');
   * server.tool({ ... });
   * const handler = await server.getHandler();
   * export default { fetch: handler };
   * ```
   */
  async getHandler(options?: {
    provider?: "supabase" | "cloudflare" | "deno-deploy";
  }): Promise<(req: Request) => Promise<Response>> {
    // Setup OAuth before mounting widgets/MCP (if configured)
    if (this.oauthConfig && !this.oauthSetupState.complete) {
      await setupOAuthForServer(
        this.app,
        this.oauthProvider,
        this.getServerBaseUrl(),
        this.oauthSetupState
      );
    }

    console.log("[MCP] Mounting widgets");
    await mountWidgets(this, {
      baseRoute: "/mcp-use/widgets",
      resourcesDir: "resources",
    });
    console.log("[MCP] Mounted widgets");
    await this.mountMcp();
    console.log("[MCP] Mounted MCP");
    console.log("[MCP] Mounting inspector");
    await this.mountInspector();
    console.log("[MCP] Mounted inspector");

    // Wrap the fetch handler to ensure it always returns a Promise<Response>
    const fetchHandler = this.app.fetch.bind(this.app);

    // Handle platform-specific path rewriting
    if (options?.provider === "supabase") {
      return async (req: Request) => {
        const rewrittenReq = rewriteSupabaseRequest(req);
        const result = await fetchHandler(rewrittenReq);
        return result;
      };
    }

    return async (req: Request) => {
      const result = await fetchHandler(req);
      return result;
    };
  }

  // Roots registration helpers
  onRootsChanged = onRootsChanged.bind(this);
  listRoots = listRoots.bind(this);

  /**
   * Mount MCP Inspector UI at /inspector
   *
   * Dynamically loads and mounts the MCP Inspector UI package if available, providing
   * a web-based interface for testing and debugging MCP servers. The inspector
   * automatically connects to the local MCP server endpoints.
   *
   * This method gracefully handles cases where the inspector package is not installed,
   * allowing the server to function without the inspector in production environments.
   *
   * @private
   * @returns void
   *
   * @example
   * If @mcp-use/inspector is installed:
   * - Inspector UI available at http://localhost:PORT/inspector
   * - Automatically connects to http://localhost:PORT/mcp (or /sse)
   *
   * If not installed:
   * - Server continues to function normally
   * - No inspector UI available
   */
  private async mountInspector(): Promise<void> {
    if (this.inspectorMounted) return;

    const mounted = await mountInspectorUI(
      this.app,
      this.serverHost,
      this.serverPort,
      isProductionModeHelper()
    );

    if (mounted) {
      this.inspectorMounted = true;
    }
  }
}

export type McpServerInstance = McpServer;

/**
 * Create a new MCP server instance
 *
 * @param name - Server name
 * @param config - Optional server configuration
 * @param config.version - Server version (defaults to '1.0.0')
 * @param config.description - Server description
 * @param config.host - Hostname for widget URLs and server endpoints (defaults to 'localhost')
 * @param config.baseUrl - Full base URL (e.g., 'https://myserver.com') - overrides host:port for widget URLs
 * @param config.allowedOrigins - Allowed origins for DNS rebinding protection
 *   - **Development mode** (NODE_ENV !== "production"): If not set, all origins are allowed
 *   - **Production mode** (NODE_ENV === "production"): Only uses explicitly configured origins
 *   - See {@link ServerConfig.allowedOrigins} for detailed documentation
 * @param config.sessionIdleTimeoutMs - Idle timeout for sessions in milliseconds (default: 300000 = 5 minutes)
 * @returns McpServerInstance with both MCP and Hono methods
 *
 * @example
 * ```typescript
 * // Basic usage (development mode - allows all origins)
 * const server = createMCPServer('my-server', {
 *   version: '1.0.0',
 *   description: 'My MCP server'
 * })
 *
 * // Production mode with explicit allowed origins
 * const server = createMCPServer('my-server', {
 *   version: '1.0.0',
 *   allowedOrigins: [
 *     'https://myapp.com',
 *     'https://app.myapp.com'
 *   ]
 * })
 *
 * // With custom host (e.g., for Docker or remote access)
 * const server = createMCPServer('my-server', {
 *   version: '1.0.0',
 *   host: '0.0.0.0' // or 'myserver.com'
 * })
 *
 * // With full base URL (e.g., behind a proxy or custom domain)
 * const server = createMCPServer('my-server', {
 *   version: '1.0.0',
 *   baseUrl: 'https://myserver.com' // or process.env.MCP_URL
 * })
 * ```
 */

// Overload: when OAuth is configured

export function createMCPServer(
  name: string,
  config: Partial<ServerConfig> & { oauth: NonNullable<ServerConfig["oauth"]> }
): McpServerInstance;

// Overload: when OAuth is not configured
// eslint-disable-next-line no-redeclare
export function createMCPServer(
  name: string,
  config?: Partial<ServerConfig>
): McpServerInstance;

// Implementation
// eslint-disable-next-line no-redeclare
export function createMCPServer(
  name: string,
  config: Partial<ServerConfig> = {}
): McpServerInstance {
  const instance = new McpServer({
    name,
    version: config.version || "1.0.0",
    description: config.description,
    host: config.host,
    baseUrl: config.baseUrl,
    allowedOrigins: config.allowedOrigins,
    sessionIdleTimeoutMs: config.sessionIdleTimeoutMs,
    autoCreateSessionOnInvalidId: config.autoCreateSessionOnInvalidId,
    oauth: config.oauth,
  }) as any;

  return instance as unknown as McpServerInstance;
}
