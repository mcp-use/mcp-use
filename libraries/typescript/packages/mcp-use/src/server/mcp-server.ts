import {
  McpServer as OfficialMcpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { Hono as HonoType } from "hono";
import { z } from "zod";

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
  ResourceSubscriptionManager,
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
import {
  findSessionContext,
  createEnhancedContext,
  isValidLogLevel,
} from "./tools/tool-execution-helpers.js";
import { getRequestContext, runWithContext } from "./context-storage.js";
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
  parseTemplateUri as parseTemplateUriHelper,
} from "./utils/index.js";
import { setupOAuthForServer } from "./oauth/setup.js";

export class MCPServer {
  /**
   * Native MCP server instance from @modelcontextprotocol/sdk
   * Exposed publicly for advanced use cases
   */
  public readonly nativeServer: OfficialMcpServer;

  /** @deprecated Use nativeServer instead - kept for backward compatibility */
  public get server(): OfficialMcpServer {
    return this.nativeServer;
  }

  private config: ServerConfig;
  public app: HonoType;
  private mcpMounted = false;
  private inspectorMounted = false;
  public serverPort?: number;
  public serverHost: string;
  public serverBaseUrl?: string;
  public registeredTools: string[] = [];
  public registeredPrompts: string[] = [];
  public registeredResources: string[] = [];
  public buildId?: string;
  public sessions = new Map<string, SessionData>();
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
   * Storage for registration "recipes" that can be replayed on new server instances
   * Following the official SDK pattern where each session gets its own server instance
   */
  private registrationRecipes = {
    tools: new Map<string, { config: any; handler: any }>(),
    prompts: new Map<string, { config: any; handler: any }>(),
    resources: new Map<string, { config: any; handler: any }>(),
    resourceTemplates: new Map<string, { config: any; handler: any }>(),
  };

  /**
   * Resource subscription manager for tracking and notifying resource updates
   */
  private subscriptionManager = new ResourceSubscriptionManager();

  /**
   * Clean up resource subscriptions for a closed session
   *
   * This method is called automatically when a session is closed to remove
   * all resource subscriptions associated with that session.
   *
   * @param sessionId - The session ID to clean up
   * @internal
   */
  public cleanupSessionSubscriptions(sessionId: string): void {
    this.subscriptionManager.cleanupSession(sessionId);
  }

  /**
   * Creates a new MCP server instance with Hono integration
   *
   * Initializes the server with the provided configuration, sets up CORS headers,
   * configures widget serving routes, and creates a proxy that allows direct
   * access to Hono methods while preserving MCP server functionality.
   *
   * @param config - Server configuration including name, version, and description
   * @returns A proxied MCPServer instance that supports both MCP and Hono methods
   */
  constructor(config: ServerConfig) {
    this.config = config;
    this.serverHost = config.host || "localhost";
    this.serverBaseUrl = config.baseUrl;

    // Create native SDK server instance with capabilities
    this.nativeServer = new OfficialMcpServer(
      {
        name: config.name,
        version: config.version,
      },
      {
        capabilities: {
          logging: {},
          resources: {
            subscribe: true,
            listChanged: true,
          },
        },
      }
    );

    // Create and configure Hono app with default middleware
    this.app = createHonoApp(requestLogger);

    this.oauthConfig = config.oauth;

    // Wrap registration methods to capture recipes for multi-session support
    this.wrapRegistrationMethods();

    // Return proxied instance that allows direct access to Hono methods
    return createHonoProxy(this, this.app);
  }

  /**
   * Wrap registration methods to capture recipes following official SDK pattern.
   * Each session will get a fresh server instance with all registrations replayed.
   */
  private wrapRegistrationMethods(): void {
    const originalTool = toolRegistration;
    const originalPrompt = registerPrompt;
    const originalResource = registerResource;
    const originalResourceTemplate = registerResourceTemplate;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.tool = (<
      T extends import("./types/index.js").ToolDefinition<any, any, boolean>,
    >(
      toolDefinition: T,
      callback?: import("./types/index.js").ToolCallback<
        import("./types/index.js").InferToolInput<T>,
        import("./types/index.js").InferToolOutput<T>,
        boolean
      >
    ) => {
      const actualCallback = callback || toolDefinition.cb;
      self.registrationRecipes.tools.set(toolDefinition.name, {
        config: toolDefinition,
        handler: actualCallback,
      });
      return originalTool.call(self, toolDefinition, callback as any);
    }) as typeof originalTool;

    this.prompt = function (promptDefinition: any, callback?: any) {
      const actualCallback = callback || promptDefinition.cb;
      self.registrationRecipes.prompts.set(promptDefinition.name, {
        config: promptDefinition,
        handler: actualCallback,
      });
      return originalPrompt.call(self, promptDefinition, callback);
    } as any;

    this.resource = function (resourceDefinition: any, callback?: any) {
      const actualCallback = callback || resourceDefinition.readCallback;
      const resourceKey = `${resourceDefinition.name}:${resourceDefinition.uri}`;
      self.registrationRecipes.resources.set(resourceKey, {
        config: resourceDefinition,
        handler: actualCallback,
      });
      return originalResource.call(self, resourceDefinition, callback);
    } as any;

    this.resourceTemplate = function (templateDefinition: any, callback?: any) {
      const actualCallback = callback || templateDefinition.readCallback;
      self.registrationRecipes.resourceTemplates.set(templateDefinition.name, {
        config: templateDefinition,
        handler: actualCallback,
      });
      return originalResourceTemplate.call(self, templateDefinition, callback);
    } as any;
  }

  /**
   * Create a new server instance for a session following official SDK pattern.
   * This is called for each initialize request to create an isolated server.
   */
  public getServerForSession(): OfficialMcpServer {
    const newServer = new OfficialMcpServer(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          logging: {},
        },
      }
    );

    // Replay all registrations on the new server
    // Tools - with context wrapping for ctx.sample(), ctx.elicit()
    for (const [name, recipe] of this.registrationRecipes.tools) {
      const { config, handler: actualCallback } = recipe;
      let inputSchema: Record<string, any>;
      if (config.schema) {
        inputSchema = this.convertZodSchemaToParams(config.schema);
      } else if (config.inputs && config.inputs.length > 0) {
        inputSchema = this.createParamsSchema(config.inputs);
      } else {
        inputSchema = {};
      }

      // Wrap handler to provide enhanced context
      const wrappedHandler = async (params: any, extra?: any) => {
        const initialRequestContext = getRequestContext();
        const extraProgressToken = extra?._meta?.progressToken;
        const extraSendNotification = extra?.sendNotification;

        const { requestContext, session, progressToken, sendNotification } =
          findSessionContext(
            this.sessions,
            initialRequestContext,
            extraProgressToken,
            extraSendNotification
          );

        // Find the sessionId by looking up the session in the sessions map
        let sessionId: string | undefined;
        if (session) {
          for (const [id, s] of this.sessions.entries()) {
            if (s === session) {
              sessionId = id;
              break;
            }
          }
        }

        // Use the session server's native createMessage and elicitInput
        // These are already properly connected to the transport
        const createMessageWithLogging = async (params: any, options?: any) => {
          console.log("[createMessage] About to call server.createMessage");
          console.log("[createMessage] Has server:", !!newServer);
          try {
            const result = await newServer.server.createMessage(
              params,
              options
            );
            console.log("[createMessage] Got result successfully");
            return result;
          } catch (err: any) {
            console.error(
              "[createMessage] Error:",
              err.message,
              "Code:",
              err.code
            );
            throw err;
          }
        };

        const enhancedContext = createEnhancedContext(
          requestContext,
          createMessageWithLogging,
          newServer.server.elicitInput.bind(newServer.server),
          progressToken,
          sendNotification,
          session?.logLevel,
          session?.clientCapabilities,
          sessionId,
          this.sessions
        );

        const executeCallback = async () => {
          if (actualCallback.length >= 2) {
            return await (actualCallback as any)(params, enhancedContext);
          }
          return await (actualCallback as any)(params);
        };

        if (requestContext) {
          return await runWithContext(requestContext, executeCallback);
        }

        return await executeCallback();
      };

      newServer.registerTool(
        name,
        {
          title: config.title,
          description: config.description ?? "",
          inputSchema,
          annotations: config.annotations,
          _meta: config._meta,
        },
        wrappedHandler
      );
    }

    // Prompts
    for (const [name, recipe] of this.registrationRecipes.prompts) {
      const { config, handler } = recipe;

      // Determine input schema - prefer schema over args
      let argsSchema: any;
      if (config.schema) {
        argsSchema = this.convertZodSchemaToParams(config.schema);
      } else if (config.args && config.args.length > 0) {
        argsSchema = this.createParamsSchema(config.args);
      } else {
        // No schema validation when neither schema nor args are provided
        argsSchema = undefined;
      }

      // Wrap handler to support both CallToolResult and GetPromptResult
      const wrappedHandler = async (params: any) => {
        const result = await handler(params);

        // If it's already a GetPromptResult, return as-is
        if ("messages" in result && Array.isArray(result.messages)) {
          return result;
        }

        // Convert CallToolResult to GetPromptResult
        const { convertToolResultToPromptResult } =
          await import("./prompts/conversion.js");
        return convertToolResultToPromptResult(result);
      };

      newServer.registerPrompt(
        name,
        {
          title: config.title,
          description: config.description ?? "",
          argsSchema: argsSchema as any,
        },
        wrappedHandler
      );
    }

    // Resources
    for (const [_key, recipe] of this.registrationRecipes.resources) {
      const { config, handler } = recipe;
      // Wrap handler to support both CallToolResult and ReadResourceResult
      const wrappedHandler = async () => {
        const result = await handler();
        // If it's already a ReadResourceResult, return as-is
        if ("contents" in result && Array.isArray(result.contents)) {
          return result;
        }
        // Convert CallToolResult to ReadResourceResult
        // Import convertToolResultToResourceResult dynamically to avoid circular dependencies
        const { convertToolResultToResourceResult } =
          await import("./resources/conversion.js");
        return convertToolResultToResourceResult(config.uri, result);
      };

      newServer.registerResource(
        config.name,
        config.uri,
        {
          title: config.title,
          description: config.description,
          mimeType: config.mimeType || "text/plain",
        },
        wrappedHandler
      );
    }

    // Resource Templates
    for (const [_name, recipe] of this.registrationRecipes.resourceTemplates) {
      const { config, handler } = recipe;

      // Detect structure type: flat (uriTemplate on config) vs nested (resourceTemplate.uriTemplate)
      const isFlatStructure = "uriTemplate" in config;

      // Extract uriTemplate and metadata based on structure
      const uriTemplate = isFlatStructure
        ? (config as any).uriTemplate
        : config.resourceTemplate.uriTemplate;

      const mimeType = isFlatStructure
        ? (config as any).mimeType
        : config.resourceTemplate.mimeType;

      const templateDescription = isFlatStructure
        ? undefined
        : config.resourceTemplate.description;

      // Create ResourceTemplate instance from SDK
      const template = new ResourceTemplate(uriTemplate, {
        list: undefined,
        complete: undefined,
      });

      // Create metadata object
      const metadata: any = {};
      if (config.title) {
        metadata.title = config.title;
      }
      if (config.description || templateDescription) {
        metadata.description = config.description || templateDescription;
      }
      if (mimeType) {
        metadata.mimeType = mimeType;
      }
      if (config.annotations) {
        metadata.annotations = config.annotations;
      }

      newServer.registerResource(
        config.name,
        template,
        metadata,
        async (uri: URL) => {
          // Parse URI parameters from the template
          const params = this.parseTemplateUri(uriTemplate, uri.toString());
          const result = await handler(uri, params);

          // If it's already a ReadResourceResult, return as-is
          if ("contents" in result && Array.isArray(result.contents)) {
            return result;
          }

          // Convert CallToolResult to ReadResourceResult
          const { convertToolResultToResourceResult } =
            await import("./resources/conversion.js");
          return convertToolResultToResourceResult(uri.toString(), result);
        }
      );
    }

    // Register logging/setLevel handler per MCP specification
    newServer.server.setRequestHandler(
      z.object({ method: z.literal("logging/setLevel") }).passthrough(),
      async (request: any) => {
        const level = request.params?.level;

        // Validate log level parameter
        if (!level) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Missing 'level' parameter"
          );
        }

        if (!isValidLogLevel(level)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid log level '${level}'. Must be one of: debug, info, notice, warning, error, critical, alert, emergency`
          );
        }

        // Get current request context to find the session
        const requestContext = getRequestContext();
        if (requestContext) {
          // Extract session ID from header
          const sessionId = requestContext.req.header("mcp-session-id");

          if (sessionId && this.sessions.has(sessionId)) {
            // Store log level in session data
            const session = this.sessions.get(sessionId)!;
            session.logLevel = level;
            console.log(
              `[MCP] Set log level to '${level}' for session ${sessionId}`
            );
            return {};
          }
        }

        // If we can't find the session, try to find it in the sessions map
        // This handles cases where the request context isn't available
        for (const [sessionId, session] of this.sessions.entries()) {
          if (session.server === newServer) {
            session.logLevel = level;
            console.log(
              `[MCP] Set log level to '${level}' for session ${sessionId}`
            );
            return {};
          }
        }

        // If no session found, return error
        console.warn(
          "[MCP] Could not find session for logging/setLevel request"
        );
        throw new McpError(ErrorCode.InternalError, "Could not find session");
      }
    );

    // Register resource subscription handlers
    this.subscriptionManager.registerHandlers(newServer, this.sessions);

    return newServer;
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
  public tool: typeof toolRegistration = toolRegistration;

  // Schema conversion helpers (used by tool registration)
  public convertZodSchemaToParams = convertZodSchemaToParams;
  public createParamsSchema = createParamsSchema;

  // Template URI parsing helper (used by resource templates)
  public parseTemplateUri = parseTemplateUriHelper;

  // Resource registration helpers
  public resource = registerResource;
  public resourceTemplate = registerResourceTemplate;

  // Prompt registration helper
  public prompt = registerPrompt;

  // Notification helpers
  public getActiveSessions = getActiveSessions;
  public sendNotification = sendNotification;
  public sendNotificationToSession = sendNotificationToSession;

  /**
   * Notify subscribed clients that a resource has been updated
   *
   * This method sends a `notifications/resources/updated` notification to all
   * sessions that have subscribed to the specified resource URI.
   *
   * @param uri - The URI of the resource that changed
   * @returns Promise that resolves when all notifications have been sent
   *
   * @example
   * ```typescript
   * // After updating a resource, notify subscribers
   * await server.notifyResourceUpdated("file:///path/to/resource.txt");
   * ```
   */
  public async notifyResourceUpdated(uri: string): Promise<void> {
    return this.subscriptionManager.notifyResourceUpdated(uri, this.sessions);
  }

  public uiResource = uiResourceRegistration as any;

  /**
   * Mount MCP server endpoints at /mcp and /sse
   *
   * Sets up the HTTP transport layer for the MCP server, creating endpoints for
   * Server-Sent Events (SSE) streaming, POST message handling, and DELETE session cleanup.
   * The transport manages multiple sessions through a single server instance.
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
      this, // Pass the MCPServer instance so mountMcp can call getServerForSession()
      this.sessions,
      this.config,
      isProductionModeHelper()
    );

    this.mcpMounted = result.mcpMounted;
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
   * @param port - Port number to listen on (defaults to 3000 if not specified)
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

  /**
   * Create a message for sampling (calling the LLM)
   * Delegates to the native SDK server
   */
  public async createMessage(
    params: CreateMessageRequest["params"],
    options?: any
  ): Promise<CreateMessageResult> {
    return await this.nativeServer.server.createMessage(params, options);
  }

  async listen(port?: number): Promise<void> {
    // Priority: parameter > PORT env var > default (3000)
    const portEnv = getEnv("PORT");
    this.serverPort = port || (portEnv ? parseInt(portEnv, 10) : 3000);

    // Update host from HOST env var if set
    const hostEnv = getEnv("HOST");
    if (hostEnv) {
      this.serverHost = hostEnv;
    }

    // Update baseUrl using the helper that checks MCP_URL env var
    // This ensures widgets/assets use the correct public URL instead of 0.0.0.0
    this.serverBaseUrl = getServerBaseUrlHelper(
      this.serverBaseUrl,
      this.serverHost,
      this.serverPort
    );

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
   * const server = new MCPServer({ name: 'my-server', version: '1.0.0' });
   * server.tool({ ... });
   * const handler = await server.getHandler({ provider: 'supabase' });
   * Deno.serve(handler);
   * ```
   *
   * @example
   * ```typescript
   * // For Cloudflare Workers
   * const server = new MCPServer({ name: 'my-server', version: '1.0.0' });
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

export type McpServerInstance = MCPServer & HonoType;

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
 * // Recommended: Use class constructor (matches MCPClient/MCPAgent pattern)
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   description: 'My MCP server'
 * })
 *
 * // Legacy: Factory function (still supported for backward compatibility)
 * const server = createMCPServer('my-server', {
 *   version: '1.0.0',
 *   description: 'My MCP server'
 * })
 *
 * // Production mode with explicit allowed origins
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   allowedOrigins: [
 *     'https://myapp.com',
 *     'https://app.myapp.com'
 *   ]
 * })
 *
 * // With custom host (e.g., for Docker or remote access)
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   host: '0.0.0.0' // or 'myserver.com'
 * })
 *
 * // With full base URL (e.g., behind a proxy or custom domain)
 * const server = new MCPServer({
 *   name: 'my-server',
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
  const instance = new MCPServer({
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
