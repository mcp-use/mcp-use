import {
  McpServer as OfficialMcpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateMessageRequest,
  CreateMessageResult,
  GetPromptResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * Options for the sample() function in tool context.
 */
export interface SampleOptions {
  /**
   * Timeout in milliseconds for the sampling request.
   * Default: no timeout (Infinity) - waits indefinitely for the LLM response.
   * Set this if you want to limit how long to wait for sampling.
   */
  timeout?: number;

  /**
   * Interval in milliseconds between progress notifications.
   * Default: 5000 (5 seconds).
   * Progress notifications are sent to the client to prevent timeout
   * when the client has resetTimeoutOnProgress enabled.
   */
  progressIntervalMs?: number;

  /**
   * Optional callback called each time a progress notification is sent.
   * Useful for logging or custom progress handling.
   */
  onProgress?: (progress: {
    progress: number;
    total?: number;
    message: string;
  }) => void;
}

/**
 * Context object passed to tool callbacks.
 * Provides access to sampling and progress reporting capabilities.
 */
export interface ToolContext {
  /**
   * Request sampling from the client's LLM with automatic progress notifications.
   *
   * Progress notifications are sent every 5 seconds (configurable) while waiting
   * for the sampling response. This prevents client-side timeouts when the client
   * has `resetTimeoutOnProgress: true` enabled.
   *
   * By default, there is no timeout - the function waits indefinitely for the
   * LLM response. Set `options.timeout` to limit the wait time.
   *
   * @param params - Sampling parameters (messages, model preferences, etc.)
   * @param options - Optional configuration for timeout and progress
   * @returns The sampling result from the client's LLM
   *
   * @example
   * ```typescript
   * // Basic usage - waits indefinitely with automatic progress notifications
   * const result = await ctx.sample({
   *   messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
   * });
   *
   * // With timeout and custom progress handling
   * const result = await ctx.sample(
   *   { messages: [...] },
   *   {
   *     timeout: 120000, // 2 minute timeout
   *     progressIntervalMs: 3000, // Report progress every 3 seconds
   *     onProgress: ({ progress, message }) => console.log(message),
   *   }
   * );
   * ```
   */
  sample: (
    params: CreateMessageRequest["params"],
    options?: SampleOptions
  ) => Promise<CreateMessageResult>;

  /**
   * Send a progress notification to the client.
   * Only available if the client requested progress updates for this tool call.
   *
   * @param progress - Current progress value (should increase with each call)
   * @param total - Total progress value if known
   * @param message - Optional message describing current progress
   */
  reportProgress?: (
    progress: number,
    total?: number,
    message?: string
  ) => Promise<void>;
}
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { Hono, type Context, type Hono as HonoType, type Next } from "hono";
import { cors } from "hono/cors";
import { runWithContext, getRequestContext } from "./context-storage.js";

import {
  createUIResourceFromDefinition,
  type UrlConfig,
} from "./adapters/mcp-ui-adapter.js";
import {
  adaptConnectMiddleware,
  isExpressMiddleware,
} from "./connect-adapter.js";
import { requestLogger } from "./logging.js";
import type {
  InputDefinition,
  PromptDefinition,
  ResourceDefinition,
  ResourceTemplateDefinition,
  ServerConfig,
  ToolDefinition,
  ToolCallback,
  UIResourceContent,
  UIResourceDefinition,
  WidgetProps,
  InferToolInput,
  InferToolOutput,
} from "./types/index.js";
import type { WidgetMetadata } from "./types/widget.js";
import {
  isDeno,
  getEnv,
  pathHelpers,
  fsHelpers,
  generateUUID,
  getCwd,
} from "./utils/runtime.js";

const TMP_MCP_USE_DIR = ".mcp-use";

export class McpServer<HasOAuth extends boolean = false> {
  private server: OfficialMcpServer;
  private config: ServerConfig;
  private app: HonoType;
  private mcpMounted = false;
  private inspectorMounted = false;
  private serverPort?: number;
  private serverHost: string;
  private serverBaseUrl?: string;
  private registeredTools: string[] = [];
  private registeredPrompts: string[] = [];
  private registeredResources: string[] = [];
  private buildId?: string;
  private sessions = new Map<
    string,
    {
      transport: any; // StreamableHTTPServerTransport
      lastAccessedAt: number;
      context?: Context; // Store Hono context for this session
    }
  >();
  private idleCleanupInterval?: NodeJS.Timeout;
  private oauthProvider?: any; // OAuthProvider from oauth/index.js
  private oauthMiddleware?: any; // Bearer auth middleware
  private oauthConfig?: any; // Store OAuth config for lazy initialization
  private oauthSetupComplete = false;

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
    this.app = new Hono();

    // Enable CORS by default
    this.app.use(
      "*",
      cors({
        origin: "*",
        allowMethods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: [
          "Content-Type",
          "Accept",
          "Authorization",
          "mcp-protocol-version",
          "mcp-session-id",
          "X-Proxy-Token",
          "X-Target-URL",
        ],
        // Expose mcp-session-id so browser clients can read it from responses
        exposeHeaders: ["mcp-session-id"],
      })
    );

    // Request logging middleware
    this.app.use("*", requestLogger);

    // Store OAuth config for lazy initialization (will be setup in listen/getHandler)
    if (config.oauth) {
      this.oauthConfig = config.oauth;
    }

    // Proxy all Hono methods to the underlying app with special handling for 'use'
    return new Proxy(this, {
      get(target, prop) {
        // Special handling for 'use' method to auto-detect and adapt Express middleware
        if (prop === "use") {
          return async (...args: any[]) => {
            // Hono's use signature: use(path?, ...handlers)
            // Check if the first arg is a path (string) or a handler (function)
            const hasPath = typeof args[0] === "string";
            const path = hasPath ? args[0] : "*";
            const handlers = hasPath ? args.slice(1) : args;

            // Adapt each handler if it's Express middleware
            const adaptedHandlers = handlers.map((handler: any) => {
              if (isExpressMiddleware(handler)) {
                // Return a promise-wrapped adapter since adaptConnectMiddleware is async
                // We'll handle this in the actual app.use call
                return { __isExpressMiddleware: true, handler, path };
              }
              return handler;
            });

            // Check if we have any Express middleware to adapt
            const hasExpressMiddleware = adaptedHandlers.some(
              (h: any) => h.__isExpressMiddleware
            );

            if (hasExpressMiddleware) {
              // We need to handle async adaptation
              // Await the adaptation to ensure middleware is registered before proceeding
              await Promise.all(
                adaptedHandlers.map(async (h: any) => {
                  if (h.__isExpressMiddleware) {
                    const adapted = await adaptConnectMiddleware(
                      h.handler,
                      h.path
                    );
                    // Call app.use with the adapted middleware
                    if (hasPath) {
                      (target.app as any).use(path, adapted);
                    } else {
                      (target.app as any).use(adapted);
                    }
                  } else {
                    // Regular Hono middleware
                    if (hasPath) {
                      (target.app as any).use(path, h);
                    } else {
                      (target.app as any).use(h);
                    }
                  }
                })
              );

              return target;
            }

            // No Express middleware, call normally
            return (target.app as any).use(...args);
          };
        }

        if (prop in target) {
          return (target as any)[prop];
        }
        const value = (target.app as any)[prop];
        return typeof value === "function" ? value.bind(target.app) : value;
      },
    }) as McpServer<HasOAuth>;
  }

  /**
   * Gets the server base URL with fallback to host:port if not configured
   * @returns The complete base URL for the server
   */
  private getServerBaseUrl(): string {
    // First check if baseUrl was explicitly set in config
    if (this.serverBaseUrl) {
      return this.serverBaseUrl;
    }
    // Then check MCP_URL environment variable
    const mcpUrl = getEnv("MCP_URL");
    if (mcpUrl) {
      return mcpUrl;
    }
    // Finally fall back to host:port
    return `http://${this.serverHost}:${this.serverPort}`;
  }

  /**
   * Gets additional CSP URLs from environment variable
   * Supports comma-separated list or single URL
   * @returns Array of URLs to add to CSP resource_domains
   */
  private getCSPUrls(): string[] {
    const cspUrlsEnv = getEnv("CSP_URLS");
    if (!cspUrlsEnv) {
      console.log("[CSP] No CSP_URLS environment variable found");
      return [];
    }

    // Split by comma and trim whitespace
    const urls = cspUrlsEnv
      .split(",")
      .map((url) => url.trim())
      .filter((url) => url.length > 0);

    console.log("[CSP] Parsed CSP URLs:", urls);
    return urls;
  }

  /**
   * Setup OAuth authentication
   *
   * Initializes OAuth provider, creates bearer auth middleware,
   * sets up OAuth routes, and applies auth to /mcp endpoints.
   *
   * @private
   */
  private async setupOAuth(oauthProvider: any): Promise<void> {
    if (this.oauthSetupComplete) {
      return; // Already setup
    }

    // Dynamically import OAuth utilities
    const { setupOAuthRoutes, createBearerAuthMiddleware } = await import(
      "./oauth/index.js"
    );

    // Store the provider (already created by factory function)
    this.oauthProvider = oauthProvider;
    console.log(`[OAuth] OAuth provider initialized`);

    // Setup OAuth routes (will be mounted immediately)
    const baseUrl = this.getServerBaseUrl();

    // Create bearer auth middleware with baseUrl for WWW-Authenticate header
    this.oauthMiddleware = createBearerAuthMiddleware(
      this.oauthProvider,
      baseUrl
    );
    setupOAuthRoutes(this.app, this.oauthProvider, baseUrl);
    const mode = this.oauthProvider.getMode?.() || "proxy";
    if (mode === "direct") {
      console.log(
        "[OAuth] Direct mode: Clients will authenticate with provider directly"
      );
      console.log("[OAuth] Metadata endpoints: /.well-known/*");
    } else {
      console.log(
        "[OAuth] Proxy mode: Routes at /authorize, /token, /.well-known/*"
      );
    }

    // Apply bearer auth to all /mcp routes
    this.app.use("/mcp/*", this.oauthMiddleware);
    console.log("[OAuth] Bearer authentication enabled on /mcp routes");

    this.oauthSetupComplete = true;
  }

  /**
   * Define a static resource that can be accessed by clients
   *
   * Registers a resource with the MCP server that clients can access via HTTP.
   * Resources are static content like files, data, or pre-computed results that
   * can be retrieved by clients without requiring parameters.
   *
   * @param resourceDefinition - Configuration object containing resource metadata and handler function
   * @param resourceDefinition.name - Unique identifier for the resource
   * @param resourceDefinition.uri - URI pattern for accessing the resource
   * @param resourceDefinition.title - Optional human-readable title for the resource
   * @param resourceDefinition.description - Optional description of the resource
   * @param resourceDefinition.mimeType - MIME type of the resource content
   * @param resourceDefinition.annotations - Optional annotations (audience, priority, lastModified)
   * @param resourceDefinition.readCallback - Async callback function that returns the resource content
   * @returns The server instance for method chaining
   *
   * @example
   * ```typescript
   * server.resource({
   *   name: 'config',
   *   uri: 'config://app-settings',
   *   title: 'Application Settings',
   *   mimeType: 'application/json',
   *   description: 'Current application configuration',
   *   annotations: {
   *     audience: ['user'],
   *     priority: 0.8
   *   },
   *   readCallback: async () => ({
   *     contents: [{
   *       uri: 'config://app-settings',
   *       mimeType: 'application/json',
   *       text: JSON.stringify({ theme: 'dark', language: 'en' })
   *     }]
   *   })
   * })
   * ```
   */
  resource(resourceDefinition: ResourceDefinition): this {
    this.server.registerResource(
      resourceDefinition.name,
      resourceDefinition.uri,
      {
        title: resourceDefinition.title,
        description: resourceDefinition.description,
        mimeType: resourceDefinition.mimeType,
        _meta: resourceDefinition._meta,
      },
      async () => {
        return await resourceDefinition.readCallback();
      }
    );
    this.registeredResources.push(resourceDefinition.name);
    return this;
  }

  /**
   * Define a dynamic resource template with parameters
   *
   * Registers a parameterized resource template with the MCP server. Templates use URI
   * patterns with placeholders that can be filled in at request time, allowing dynamic
   * resource generation based on parameters.
   *
   * @param resourceTemplateDefinition - Configuration object for the resource template
   * @param resourceTemplateDefinition.name - Unique identifier for the template
   * @param resourceTemplateDefinition.resourceTemplate - ResourceTemplate object with uriTemplate and metadata
   * @param resourceTemplateDefinition.readCallback - Async callback function that generates resource content from URI and params
   * @returns The server instance for method chaining
   *
   * @example
   * ```typescript
   * server.resourceTemplate({
   *   name: 'user-profile',
   *   resourceTemplate: {
   *     uriTemplate: 'user://{userId}/profile',
   *     name: 'User Profile',
   *     mimeType: 'application/json'
   *   },
   *   readCallback: async (uri, params) => ({
   *     contents: [{
   *       uri: uri.toString(),
   *       mimeType: 'application/json',
   *       text: JSON.stringify({ userId: params.userId, name: 'John Doe' })
   *     }]
   *   })
   * })
   * ```
   */
  resourceTemplate(
    resourceTemplateDefinition: ResourceTemplateDefinition
  ): this {
    // Create ResourceTemplate instance from SDK
    const template = new ResourceTemplate(
      resourceTemplateDefinition.resourceTemplate.uriTemplate,
      {
        list: undefined, // Optional: callback to list all matching resources
        complete: undefined, // Optional: callback for auto-completion
      }
    );

    // Create metadata object with optional fields
    const metadata: any = {};
    if (resourceTemplateDefinition.title) {
      metadata.title = resourceTemplateDefinition.title;
    }
    if (
      resourceTemplateDefinition.description ||
      resourceTemplateDefinition.resourceTemplate.description
    ) {
      metadata.description =
        resourceTemplateDefinition.description ||
        resourceTemplateDefinition.resourceTemplate.description;
    }
    if (resourceTemplateDefinition.resourceTemplate.mimeType) {
      metadata.mimeType = resourceTemplateDefinition.resourceTemplate.mimeType;
    }
    if (resourceTemplateDefinition.annotations) {
      metadata.annotations = resourceTemplateDefinition.annotations;
    }

    this.server.registerResource(
      resourceTemplateDefinition.name,
      template,
      metadata,
      async (uri: URL) => {
        // Parse URI parameters from the template
        const params = this.parseTemplateUri(
          resourceTemplateDefinition.resourceTemplate.uriTemplate,
          uri.toString()
        );
        return await resourceTemplateDefinition.readCallback(uri, params);
      }
    );
    this.registeredResources.push(resourceTemplateDefinition.name);
    return this;
  }

  /**
   * Define a tool that can be called by clients
   *
   * Registers a tool with the MCP server that clients can invoke with parameters.
   * Tools are functions that perform actions, computations, or operations and
   * return results. They accept structured input parameters and return structured output.
   *
   * Supports Apps SDK metadata for ChatGPT integration via the _meta field.
   *
   * @param toolDefinition - Configuration object containing tool metadata and handler function
   * @param toolDefinition.name - Unique identifier for the tool
   * @param toolDefinition.description - Optional human-readable description of what the tool does
   * @param toolDefinition.inputs - Array of input parameter definitions (legacy, use schema instead)
   * @param toolDefinition.schema - Zod object schema for input validation (preferred)
   * @param toolDefinition.outputSchema - Zod object schema for structured output validation
   * @param toolDefinition.cb - Async callback function that executes the tool logic with provided parameters
   * @param toolDefinition._meta - Optional metadata for the tool (e.g. Apps SDK metadata)
   * @param callback - Optional separate callback function (alternative to cb property)
   * @returns The server instance for method chaining
   *
   * @example
   * ```typescript
   * // Using Zod schema (preferred)
   * server.tool({
   *   name: 'calculate',
   *   description: 'Performs mathematical calculations',
   *   schema: z.object({
   *     expression: z.string(),
   *     precision: z.number().optional()
   *   }),
   *   cb: async ({ expression, precision = 2 }) => {
   *     const result = eval(expression)
   *     return text(`Result: ${result.toFixed(precision)}`)
   *   }
   * })
   *
   * // Using legacy inputs array
   * server.tool({
   *   name: 'greet',
   *   inputs: [{ name: 'name', type: 'string', required: true }],
   *   cb: async ({ name }) => text(`Hello, ${name}!`)
   * })
   *
   * // With separate callback for better typing
   * server.tool({
   *   name: 'add',
   *   schema: z.object({ a: z.number(), b: z.number() })
   * }, async ({ a, b }) => text(`${a + b}`))
   * ```
   */
  // Overload for separate callback with automatic type inference
  tool<T extends ToolDefinition<any, any, HasOAuth>>(
    toolDefinition: T,
    callback: ToolCallback<InferToolInput<T>, InferToolOutput<T>, HasOAuth>
  ): this;

  // Overload for inline callback
  tool<T extends ToolDefinition<any, any, HasOAuth>>(toolDefinition: T): this;

  // Implementation
  tool<T extends ToolDefinition<any, any, HasOAuth>>(
    toolDefinition: T,
    callback?: ToolCallback<InferToolInput<T>, InferToolOutput<T>, HasOAuth>
  ): this {
    // Determine which callback to use
    const actualCallback = callback || toolDefinition.cb;

    if (!actualCallback) {
      throw new Error(
        `Tool '${toolDefinition.name}' must have either a cb property or a callback parameter`
      );
    }

    // Determine input schema - prefer schema over inputs
    let inputSchema: Record<string, z.ZodSchema>;

    if (toolDefinition.schema) {
      // Use Zod schema if provided
      inputSchema = this.convertZodSchemaToParams(toolDefinition.schema);
    } else if (toolDefinition.inputs && toolDefinition.inputs.length > 0) {
      // Fall back to inputs array for backward compatibility
      inputSchema = this.createParamsSchema(toolDefinition.inputs);
    } else {
      // No schema defined - empty schema
      inputSchema = {};
    }

    this.server.registerTool(
      toolDefinition.name,
      {
        title: toolDefinition.title,
        description: toolDefinition.description ?? "",
        inputSchema,
        annotations: toolDefinition.annotations,
        _meta: toolDefinition._meta,
      },
      async (params: any, extra?: any) => {
        // Get the HTTP request context from AsyncLocalStorage
        // If not available (SDK broke async chain), try to find it from active sessions
        let requestContext = getRequestContext();

        if (!requestContext) {
          // Fallback: Find context from any active session
          // In practice, there's usually only one active request at a time per session
          for (const [, session] of this.sessions.entries()) {
            if (session.context) {
              requestContext = session.context;
              break;
            }
          }
        }

        // Extract progress token from request metadata
        const progressToken = extra?._meta?.progressToken;

        // Create enhanced context that combines ToolContext methods with Hono request context
        // This provides a unified interface with sample(), reportProgress(), auth, req, etc.
        const enhancedContext = requestContext
          ? Object.create(requestContext)
          : {};

        /**
         * Request sampling from the client's LLM with automatic progress notifications.
         *
         * Progress notifications are sent every 5 seconds (configurable) while waiting
         * for the sampling response. This prevents client-side timeouts when
         * resetTimeoutOnProgress is enabled.
         *
         * @param params - Sampling parameters (messages, model preferences, etc.)
         * @param options - Optional configuration
         * @param options.timeout - Timeout in milliseconds (default: no timeout / Infinity)
         * @param options.progressIntervalMs - Interval between progress notifications (default: 5000ms)
         * @param options.onProgress - Optional callback called each time progress is reported
         * @returns The sampling result from the client's LLM
         */
        enhancedContext.sample = async (
          sampleParams: CreateMessageRequest["params"],
          options?: SampleOptions
        ): Promise<CreateMessageResult> => {
          const {
            timeout,
            progressIntervalMs = 5000,
            onProgress,
          } = options ?? {};

          let progressCount = 0;
          let completed = false;
          let progressInterval: ReturnType<typeof setInterval> | null = null;

          // Set up progress notifications if we have a progress token
          if (progressToken && extra?.sendNotification) {
            progressInterval = setInterval(async () => {
              if (completed) return;

              progressCount++;
              const progressData = {
                progress: progressCount,
                total: undefined as number | undefined,
                message: `Waiting for LLM response... (${progressCount * Math.round(progressIntervalMs / 1000)}s elapsed)`,
              };

              // Call user's progress callback if provided
              if (onProgress) {
                try {
                  onProgress(progressData);
                } catch {
                  // Ignore errors in progress callback
                }
              }

              // Send progress notification to client
              try {
                await extra.sendNotification({
                  method: "notifications/progress",
                  params: {
                    progressToken,
                    progress: progressData.progress,
                    total: progressData.total,
                    message: progressData.message,
                  },
                });
              } catch {
                // Ignore errors - request might have completed
              }
            }, progressIntervalMs);
          }

          try {
            // Create the sampling promise
            const samplePromise = this.createMessage(sampleParams);

            // If timeout is specified, race against it
            if (timeout && timeout !== Infinity) {
              const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(
                  () =>
                    reject(new Error(`Sampling timed out after ${timeout}ms`)),
                  timeout
                );
              });
              return await Promise.race([samplePromise, timeoutPromise]);
            }

            // No timeout - wait indefinitely
            return await samplePromise;
          } finally {
            completed = true;
            if (progressInterval) {
              clearInterval(progressInterval);
            }
          }
        };

        /**
         * Send a progress notification to the client.
         * Only works if the client requested progress updates for this tool call.
         */
        enhancedContext.reportProgress =
          progressToken && extra?.sendNotification
            ? async (progress: number, total?: number, message?: string) => {
                await extra.sendNotification({
                  method: "notifications/progress",
                  params: {
                    progressToken,
                    progress,
                    total,
                    message,
                  },
                });
              }
            : undefined;

        // Wrap callback execution with context to ensure AsyncLocalStorage works
        const executeCallback = async () => {
          if (actualCallback.length >= 2) {
            // Pass the enhanced context that includes sample, reportProgress, auth, req, etc.
            return await (actualCallback as any)(params, enhancedContext);
          }
          // Single parameter callback - just input
          return await (actualCallback as any)(params);
        };

        // If we have a request context, wrap execution with it
        if (requestContext) {
          return await runWithContext(requestContext, executeCallback);
        }

        return await executeCallback();
      }
    );
    this.registeredTools.push(toolDefinition.name);
    return this;
  }

  /**
   * Define a prompt template
   *
   * Registers a prompt template with the MCP server that clients can use to generate
   * structured prompts for AI models. Prompt templates accept parameters and return
   * formatted text that can be used as input to language models or other AI systems.
   *
   * @param promptDefinition - Configuration object containing prompt metadata and handler function
   * @param promptDefinition.name - Unique identifier for the prompt template
   * @param promptDefinition.description - Human-readable description of the prompt's purpose
   * @param promptDefinition.args - Array of argument definitions with types and validation
   * @param promptDefinition.cb - Async callback function that generates the prompt from provided arguments
   * @returns The server instance for method chaining
   *
   * @example
   * ```typescript
   * server.prompt({
   *   name: 'code-review',
   *   description: 'Generates a code review prompt',
   *   args: [
   *     { name: 'language', type: 'string', required: true },
   *     { name: 'focus', type: 'string', required: false }
   *   ],
   *   cb: async ({ language, focus = 'general' }) => {
   *     return {
   *       messages: [{
   *         role: 'user',
   *         content: `Please review this ${language} code with focus on ${focus}...`
   *       }]
   *     }
   *   }
   * })
   * ```
   */
  prompt(promptDefinition: PromptDefinition): this {
    const argsSchema = this.createParamsSchema(promptDefinition.args || []);
    this.server.registerPrompt(
      promptDefinition.name,
      {
        title: promptDefinition.title,
        description: promptDefinition.description ?? "",
        argsSchema,
      },
      async (params: any): Promise<GetPromptResult> => {
        return await promptDefinition.cb(params);
      }
    );
    this.registeredPrompts.push(promptDefinition.name);
    return this;
  }

  /**
   * Request LLM sampling from connected clients.
   *
   * This method allows server tools to request LLM completions from clients
   * that support the sampling capability. The client will handle model selection,
   * user approval (human-in-the-loop), and return the generated response.
   *
   * @param params - Sampling request parameters including messages, model preferences, etc.
   * @param options - Optional request options (timeouts, cancellation, etc.)
   * @returns Promise resolving to the generated message from the client's LLM
   *
   * @example
   * ```typescript
   * // In a tool callback
   * server.tool({
   *   name: 'analyze-sentiment',
   *   description: 'Analyze sentiment using LLM',
   *   inputs: [{ name: 'text', type: 'string', required: true }],
   *   cb: async (params, ctx) => {
   *     const result = await ctx.sample({
   *       messages: [{
   *         role: 'user',
   *         content: { type: 'text', text: `Analyze sentiment: ${params.text}` }
   *       }],
   *       modelPreferences: {
   *         intelligencePriority: 0.8,
   *         speedPriority: 0.5
   *       }
   *     });
   *     return {
   *       content: [{ type: 'text', text: result.content.text }]
   *     };
   *   }
   * })
   * ```
   */
  async createMessage(
    params: CreateMessageRequest["params"],
    options?: RequestOptions
  ): Promise<CreateMessageResult> {
    console.log("createMessage", params, options);
    // The official SDK's McpServer has a `server` property which is the Server instance
    // The Server instance has the createMessage method
    return await this.server.server.createMessage(params, options);
  }

  /**
   * Register a UI widget as both a tool and a resource
   *
   * Creates a unified interface for MCP-UI compatible widgets that can be accessed
   * either as tools (with parameters) or as resources (static access). The tool
   * allows dynamic parameter passing while the resource provides discoverable access.
   *
   * Supports multiple UI resource types:
   * - externalUrl: Legacy MCP-UI iframe-based widgets
   * - rawHtml: Legacy MCP-UI raw HTML content
   * - remoteDom: Legacy MCP-UI Remote DOM scripting
   * - appsSdk: OpenAI Apps SDK compatible widgets (text/html+skybridge)
   *
   * @param widgetNameOrDefinition - Widget name (string) for auto-loading schema, or full configuration object
   * @param definition.name - Unique identifier for the resource
   * @param definition.type - Type of UI resource (externalUrl, rawHtml, remoteDom, appsSdk)
   * @param definition.title - Human-readable title for the widget
   * @param definition.description - Description of the widget's functionality
   * @param definition.props - Widget properties configuration with types and defaults
   * @param definition.size - Preferred iframe size [width, height] (e.g., ['900px', '600px'])
   * @param definition.annotations - Resource annotations for discovery
   * @param definition.appsSdkMetadata - Apps SDK specific metadata (CSP, widget description, etc.)
   * @returns The server instance for method chaining
   *
   * @example
   * ```typescript
   * // Simple usage - auto-loads from generated schema
   * server.uiResource('display-weather')
   *
   * // Legacy MCP-UI widget
   * server.uiResource({
   *   type: 'externalUrl',
   *   name: 'kanban-board',
   *   widget: 'kanban-board',
   *   title: 'Kanban Board',
   *   description: 'Interactive task management board',
   *   props: {
   *     initialTasks: {
   *       type: 'array',
   *       description: 'Initial tasks to display',
   *       required: false
   *     }
   *   },
   *   size: ['900px', '600px']
   * })
   *
   * // Apps SDK widget
   * server.uiResource({
   *   type: 'appsSdk',
   *   name: 'kanban-board',
   *   title: 'Kanban Board',
   *   description: 'Interactive task management board',
   *   htmlTemplate: `
   *     <div id="kanban-root"></div>
   *     <style>${kanbanCSS}</style>
   *     <script type="module">${kanbanJS}</script>
   *   `,
   *   appsSdkMetadata: {
   *     'openai/widgetDescription': 'Displays an interactive kanban board',
   *     'openai/widgetCSP': {
   *       connect_domains: [],
   *       resource_domains: ['https://cdn.example.com']
   *     }
   *   }
   * })
   * ```
   */
  uiResource(definition: UIResourceDefinition): this {
    const displayName = definition.title || definition.name;

    // Determine resource URI and mimeType based on type
    let resourceUri: string;
    let mimeType: string;

    switch (definition.type) {
      case "externalUrl":
        resourceUri = this.generateWidgetUri(definition.widget);
        mimeType = "text/uri-list";
        break;
      case "rawHtml":
        resourceUri = this.generateWidgetUri(definition.name);
        mimeType = "text/html";
        break;
      case "remoteDom":
        resourceUri = this.generateWidgetUri(definition.name);
        mimeType = "application/vnd.mcp-ui.remote-dom+javascript";
        break;
      case "appsSdk":
        resourceUri = this.generateWidgetUri(definition.name, ".html");
        mimeType = "text/html+skybridge";
        break;
      default:
        throw new Error(
          `Unsupported UI resource type. Must be one of: externalUrl, rawHtml, remoteDom, appsSdk`
        );
    }

    // Register the resource
    this.resource({
      name: definition.name,
      uri: resourceUri,
      title: definition.title,
      description: definition.description,
      mimeType,
      _meta: definition._meta,
      annotations: definition.annotations,
      readCallback: async () => {
        // For externalUrl type, use default props. For others, use empty params
        const params =
          definition.type === "externalUrl"
            ? this.applyDefaultProps(definition.props)
            : {};

        const uiResource = this.createWidgetUIResource(definition, params);

        // Ensure the resource content URI matches the registered URI (with build ID)
        uiResource.resource.uri = resourceUri;

        return {
          contents: [uiResource.resource],
        };
      },
    });

    // For Apps SDK, also register a resource template to handle dynamic URIs with random IDs
    if (definition.type === "appsSdk") {
      // Build URI template with build ID if available
      const buildIdPart = this.buildId ? `-${this.buildId}` : "";
      const uriTemplate = `ui://widget/${definition.name}${buildIdPart}-{id}.html`;

      this.resourceTemplate({
        name: `${definition.name}-dynamic`,
        resourceTemplate: {
          uriTemplate,
          name: definition.title || definition.name,
          description: definition.description,
          mimeType,
        },
        _meta: definition._meta,
        title: definition.title,
        description: definition.description,
        annotations: definition.annotations,
        readCallback: async (uri, params) => {
          // Use empty params for Apps SDK since structuredContent is passed separately
          const uiResource = this.createWidgetUIResource(definition, {});

          // Ensure the resource content URI matches the template URI (with build ID)
          uiResource.resource.uri = uri.toString();

          return {
            contents: [uiResource.resource],
          };
        },
      });
    }

    // Register the tool - returns UIResource with parameters
    // For Apps SDK, include the outputTemplate metadata
    const toolMetadata: Record<string, unknown> = definition._meta || {};

    if (definition.type === "appsSdk" && definition.appsSdkMetadata) {
      // Add Apps SDK tool metadata
      toolMetadata["openai/outputTemplate"] = resourceUri;

      // Copy over tool-relevant metadata fields from appsSdkMetadata
      const toolMetadataFields = [
        "openai/toolInvocation/invoking",
        "openai/toolInvocation/invoked",
        "openai/widgetAccessible",
        "openai/resultCanProduceWidget",
      ] as const;

      for (const field of toolMetadataFields) {
        if (definition.appsSdkMetadata[field] !== undefined) {
          toolMetadata[field] = definition.appsSdkMetadata[field];
        }
      }
    }

    this.tool({
      name: definition.name,
      title: definition.title,
      description: definition.description,
      inputs: this.convertPropsToInputs(definition.props),
      _meta: Object.keys(toolMetadata).length > 0 ? toolMetadata : undefined,
      cb: async (params: any) => {
        // Create the UIResource with user-provided params
        const uiResource = this.createWidgetUIResource(definition, params);

        // For Apps SDK, return _meta at top level with only text in content
        if (definition.type === "appsSdk") {
          // Generate a unique URI with random ID for each invocation
          const randomId = Math.random().toString(36).substring(2, 15);
          const uniqueUri = this.generateWidgetUri(
            definition.name,
            ".html",
            randomId
          );

          // Update toolMetadata with the unique URI
          const uniqueToolMetadata = {
            ...toolMetadata,
            "openai/outputTemplate": uniqueUri,
          };

          return {
            _meta: uniqueToolMetadata,
            content: [
              {
                type: "text" as const,
                text: `Displaying ${displayName}`,
              },
            ],
            // structuredContent will be injected as window.openai.toolOutput by Apps SDK
            structuredContent: params,
          };
        }

        // For other types, return standard response
        return {
          content: [
            {
              type: "text" as const,
              text: `Displaying ${displayName}`,
              description: `Show MCP-UI widget for ${displayName}`,
            },
            uiResource,
          ],
        };
      },
    });

    return this;
  }

  /**
   * Create a UIResource object for a widget with the given parameters
   *
   * This method is shared between tool and resource handlers to avoid duplication.
   * It creates a consistent UIResource structure that can be rendered by MCP-UI
   * compatible clients.
   *
   * @private
   * @param definition - UIResource definition
   * @param params - Parameters to pass to the widget via URL
   * @returns UIResource object compatible with MCP-UI
   */
  private createWidgetUIResource(
    definition: UIResourceDefinition,
    params: Record<string, any>
  ): UIResourceContent {
    // If baseUrl is set, parse it to extract protocol, host, and port
    let configBaseUrl = `http://${this.serverHost}`;
    let configPort: number | string = this.serverPort || 3001;

    if (this.serverBaseUrl) {
      try {
        const url = new URL(this.serverBaseUrl);
        configBaseUrl = `${url.protocol}//${url.hostname}`;
        configPort = url.port || (url.protocol === "https:" ? 443 : 80);
      } catch (e) {
        // Fall back to host:port if baseUrl parsing fails
        console.warn("Failed to parse baseUrl, falling back to host:port", e);
      }
    }

    const urlConfig: UrlConfig = {
      baseUrl: configBaseUrl,
      port: configPort,
      buildId: this.buildId,
    };

    const uiResource = createUIResourceFromDefinition(
      definition,
      params,
      urlConfig
    );

    // Merge definition._meta into the resource's _meta
    // This includes mcp-use/widget metadata alongside appsSdkMetadata
    if (definition._meta && Object.keys(definition._meta).length > 0) {
      uiResource.resource._meta = {
        ...uiResource.resource._meta,
        ...definition._meta,
      };
    }

    return uiResource;
  }

  /**
   * Generate a widget URI with optional build ID for cache busting
   *
   * @private
   * @param widgetName - Widget name/identifier
   * @param extension - Optional file extension (e.g., '.html')
   * @param suffix - Optional suffix (e.g., random ID for dynamic URIs)
   * @returns Widget URI with build ID if available
   */
  private generateWidgetUri(
    widgetName: string,
    extension: string = "",
    suffix: string = ""
  ): string {
    const parts = [widgetName];

    // Add build ID if available (for cache busting)
    if (this.buildId) {
      parts.push(this.buildId);
    }

    // Add suffix if provided (e.g., random ID for dynamic URIs)
    if (suffix) {
      parts.push(suffix);
    }

    // Construct URI: ui://widget/name-buildId-suffix.extension
    return `ui://widget/${parts.join("-")}${extension}`;
  }

  /**
   * Convert widget props definition to tool input schema
   *
   * Transforms the widget props configuration into the format expected by
   * the tool registration system, mapping types and handling defaults.
   *
   * @private
   * @param props - Widget props configuration
   * @returns Array of InputDefinition objects for tool registration
   */
  private convertPropsToInputs(props?: WidgetProps): InputDefinition[] {
    if (!props) return [];

    return Object.entries(props).map(([name, prop]) => ({
      name,
      type: prop.type,
      description: prop.description,
      required: prop.required,
      default: prop.default,
    }));
  }

  /**
   * Apply default values to widget props
   *
   * Extracts default values from the props configuration to use when
   * the resource is accessed without parameters.
   *
   * @private
   * @param props - Widget props configuration
   * @returns Object with default values for each prop
   */
  private applyDefaultProps(props?: WidgetProps): Record<string, any> {
    if (!props) return {};

    const defaults: Record<string, any> = {};
    for (const [key, prop] of Object.entries(props)) {
      if (prop.default !== undefined) {
        defaults[key] = prop.default;
      }
    }
    return defaults;
  }

  /**
   * Check if server is running in production mode
   *
   * @private
   * @returns true if in production mode, false otherwise
   */
  private isProductionMode(): boolean {
    // Only check NODE_ENV - CLI commands set this explicitly
    // 'mcp-use dev' sets NODE_ENV=development
    // 'mcp-use start' sets NODE_ENV=production
    return getEnv("NODE_ENV") === "production";
  }

  /**
   * Read build manifest file
   *
   * @private
   * @returns Build manifest or null if not found
   */
  private async readBuildManifest(): Promise<{
    includeInspector: boolean;
    widgets: string[];
    buildTime?: string;
  } | null> {
    try {
      const manifestPath = pathHelpers.join(
        isDeno ? "." : getCwd(),
        "dist",
        "mcp-use.json"
      );
      const content = await fsHelpers.readFileSync(manifestPath, "utf8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Mount widget files - automatically chooses between dev and production mode
   *
   * In development mode: creates Vite dev servers with HMR support
   * In production mode: serves pre-built static widgets
   *
   * @param options - Configuration options
   * @param options.baseRoute - Base route for widgets (defaults to '/mcp-use/widgets')
   * @param options.resourcesDir - Directory containing widget files (defaults to 'resources')
   * @returns Promise that resolves when all widgets are mounted
   */
  async mountWidgets(options?: {
    baseRoute?: string;
    resourcesDir?: string;
  }): Promise<void> {
    if (this.isProductionMode() || isDeno) {
      console.log("[WIDGETS] Mounting widgets in production mode");
      await this.mountWidgetsProduction(options);
    } else {
      console.log("[WIDGETS] Mounting widgets in development mode");
      await this.mountWidgetsDev(options);
    }
  }

  /**
   * Mount individual widget files from resources/ directory in development mode
   *
   * Scans the resources/ directory for .tsx/.ts widget files and creates individual
   * Vite dev servers for each widget with HMR support. Each widget is served at its
   * own route: /mcp-use/widgets/{widget-name}
   *
   * @private
   * @param options - Configuration options
   * @param options.baseRoute - Base route for widgets (defaults to '/mcp-use/widgets')
   * @param options.resourcesDir - Directory containing widget files (defaults to 'resources')
   * @returns Promise that resolves when all widgets are mounted
   */
  private async mountWidgetsDev(options?: {
    baseRoute?: string;
    resourcesDir?: string;
  }): Promise<void> {
    const { promises: fs } = await import("node:fs");
    const baseRoute = options?.baseRoute || "/mcp-use/widgets";
    const resourcesDir = options?.resourcesDir || "resources";
    const srcDir = pathHelpers.join(getCwd(), resourcesDir);

    // Check if resources directory exists
    try {
      await fs.access(srcDir);
    } catch (error) {
      console.log(
        `[WIDGETS] No ${resourcesDir}/ directory found - skipping widget serving`
      );
      return;
    }

    // Find all TSX widget files and folders with widget.tsx
    const entries: Array<{ name: string; path: string }> = [];
    try {
      const files = await fs.readdir(srcDir, { withFileTypes: true });
      for (const dirent of files) {
        // Exclude macOS resource fork files and other hidden/system files
        if (
          dirent.name.startsWith("._") ||
          dirent.name.startsWith(".DS_Store")
        ) {
          continue;
        }

        if (
          dirent.isFile() &&
          (dirent.name.endsWith(".tsx") || dirent.name.endsWith(".ts"))
        ) {
          // Single file widget
          entries.push({
            name: dirent.name.replace(/\.tsx?$/, ""),
            path: pathHelpers.join(srcDir, dirent.name),
          });
        } else if (dirent.isDirectory()) {
          // Check for widget.tsx in folder
          const widgetPath = pathHelpers.join(
            srcDir,
            dirent.name,
            "widget.tsx"
          );
          try {
            await fs.access(widgetPath);
            entries.push({
              name: dirent.name,
              path: widgetPath,
            });
          } catch {
            // widget.tsx doesn't exist in this folder, skip it
          }
        }
      }
    } catch (error) {
      console.log(`[WIDGETS] No widgets found in ${resourcesDir}/ directory`);
      return;
    }

    if (entries.length === 0) {
      console.log(`[WIDGETS] No widgets found in ${resourcesDir}/ directory`);
      return;
    }

    // Create a temp directory for widget entry files
    const tempDir = pathHelpers.join(getCwd(), TMP_MCP_USE_DIR);
    await fs.mkdir(tempDir, { recursive: true }).catch(() => {});

    // Import dev dependencies - these are optional and only needed for dev mode
    // Using dynamic string-based imports to prevent static analysis by bundlers
    let createServer: any;
    let react: any;
    let tailwindcss: any;

    try {
      // Use Function constructor to create truly dynamic imports that can't be statically analyzed
      // eslint-disable-next-line no-new-func
      const viteModule = await new Function('return import("vite")')();
      createServer = viteModule.createServer;
      // eslint-disable-next-line no-new-func
      const reactModule = await new Function(
        'return import("@vitejs/plugin-react")'
      )();
      react = reactModule.default;
      // eslint-disable-next-line no-new-func
      const tailwindModule = await new Function(
        'return import("@tailwindcss/vite")'
      )();
      tailwindcss = tailwindModule.default;
    } catch (error) {
      console.error(
        "[WIDGETS] Dev dependencies not available. Install vite, @vitejs/plugin-react, and @tailwindcss/vite for widget development."
      );
      console.error(
        "[WIDGETS] For production, use 'mcp-use build' to pre-build widgets."
      );
      return;
    }

    const widgets = entries.map((entry) => {
      return {
        name: entry.name,
        description: `Widget: ${entry.name}`,
        entry: entry.path,
      };
    });

    // Create entry files for each widget
    for (const widget of widgets) {
      // Create temp entry and HTML files for this widget
      const widgetTempDir = pathHelpers.join(tempDir, widget.name);
      await fs.mkdir(widgetTempDir, { recursive: true });

      // Create a CSS file with Tailwind and @source directives to scan resources
      const resourcesPath = pathHelpers.join(getCwd(), resourcesDir);
      const relativeResourcesPath = pathHelpers
        .relative(widgetTempDir, resourcesPath)
        .replace(/\\/g, "/");
      const cssContent = `@import "tailwindcss";

/* Configure Tailwind to scan the resources directory */
@source "${relativeResourcesPath}";
`;
      await fs.writeFile(
        pathHelpers.join(widgetTempDir, "styles.css"),
        cssContent,
        "utf8"
      );

      const entryContent = `import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import Component from '${widget.entry}'

const container = document.getElementById('widget-root')
if (container && Component) {
  const root = createRoot(container)
  root.render(<Component />)
}
`;

      const htmlContent = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${widget.name} Widget</title>
  </head>
  <body>
    <div id="widget-root"></div>
    <script type="module" src="${baseRoute}/${widget.name}/entry.tsx"></script>
  </body>
</html>`;

      await fs.writeFile(
        pathHelpers.join(widgetTempDir, "entry.tsx"),
        entryContent,
        "utf8"
      );
      await fs.writeFile(
        pathHelpers.join(widgetTempDir, "index.html"),
        htmlContent,
        "utf8"
      );
    }

    // Build the server origin URL
    const serverOrigin = this.getServerBaseUrl();

    // Create a single shared Vite dev server for all widgets
    console.log(
      `[WIDGETS] Serving ${entries.length} widget(s) with shared Vite dev server and HMR`
    );

    // Create a plugin to handle CSS imports in SSR only
    const ssrCssPlugin = {
      name: "ssr-css-handler",
      enforce: "pre" as const,
      resolveId(
        id: string,
        importer: string | undefined,
        options?: { ssr?: boolean }
      ) {
        // Only intercept CSS in SSR mode - be very explicit about this
        if (
          options &&
          options.ssr === true &&
          (id.endsWith(".css") || id.endsWith(".module.css"))
        ) {
          return "\0ssr-css:" + id;
        }
        // Don't interfere with normal resolution
        return null;
      },
      load(id: string, options?: { ssr?: boolean }) {
        // Only return empty export for CSS files in SSR mode
        if (options && options.ssr === true && id.startsWith("\0ssr-css:")) {
          return "export default {}";
        }
        // Don't interfere with normal loading
        return null;
      },
    };

    // Create a plugin to ensure Vite watches the resources directory for HMR
    const watchResourcesPlugin = {
      name: "watch-resources",
      configureServer(server: any) {
        // Explicitly add the resources directory to Vite's watch list
        // This ensures HMR works when widget source files change
        const resourcesPath = pathHelpers.join(getCwd(), resourcesDir);
        server.watcher.add(resourcesPath);
        console.log(`[WIDGETS] Watching resources directory: ${resourcesPath}`);
      },
    };

    const viteServer = await createServer({
      root: tempDir,
      base: baseRoute + "/",
      plugins: [ssrCssPlugin, watchResourcesPlugin, tailwindcss(), react()],
      resolve: {
        alias: {
          "@": pathHelpers.join(getCwd(), resourcesDir),
        },
      },
      server: {
        middlewareMode: true,
        origin: serverOrigin,
        watch: {
          // Watch the resources directory for HMR to work
          // This ensures changes to widget source files trigger hot reload
          ignored: ["**/node_modules/**", "**/.git/**"],
          // Include the resources directory in watch list
          // Vite will watch files imported from outside root
          usePolling: false,
        },
      },
      // Explicitly tell Vite to watch files outside root
      // This is needed because widget entry files import from resources directory
      optimizeDeps: {
        // Don't optimize dependencies that might change
        exclude: [],
      },
      ssr: {
        // Force Vite to transform these packages in SSR instead of using external requires
        noExternal: ["@openai/apps-sdk-ui", "react-router"],
      },
      define: {
        // Define process.env for SSR context
        "process.env.NODE_ENV": JSON.stringify(
          process.env.NODE_ENV || "development"
        ),
        "import.meta.env.DEV": true,
        "import.meta.env.PROD": false,
        "import.meta.env.MODE": JSON.stringify("development"),
        "import.meta.env.SSR": true,
      },
    });

    // Custom middleware to handle widget-specific paths
    this.app.use(`${baseRoute}/*`, async (c: Context, next: Next) => {
      const url = new URL(c.req.url);
      const pathname = url.pathname;
      const widgetMatch = pathname.replace(baseRoute, "").match(/^\/([^/]+)/);

      if (widgetMatch) {
        const widgetName = widgetMatch[1];
        const widget = widgets.find((w) => w.name === widgetName);

        if (widget) {
          // If requesting the root of a widget, serve its index.html
          const relativePath = pathname.replace(baseRoute, "");
          if (
            relativePath === `/${widgetName}` ||
            relativePath === `/${widgetName}/`
          ) {
            // Rewrite the URL for Vite by creating a new request with modified URL
            const newUrl = new URL(c.req.url);
            newUrl.pathname = `${baseRoute}/${widgetName}/index.html`;
            // Create a new request with modified URL and update the context
            const newRequest = new Request(newUrl.toString(), c.req.raw);
            // Update the request in the context by creating a new context-like object
            Object.defineProperty(c, "req", {
              value: {
                ...c.req,
                url: newUrl.toString(),
                raw: newRequest,
              },
              writable: false,
              configurable: true,
            });
          }
        }
      }

      await next();
    });

    // Mount the single Vite server for all widgets using adapter
    const viteMiddleware = await adaptConnectMiddleware(
      viteServer.middlewares,
      `${baseRoute}/*`
    );
    this.app.use(`${baseRoute}/*`, viteMiddleware);

    // Serve static files from public directory in dev mode
    this.app.get("/mcp-use/public/*", async (c: Context) => {
      const filePath = c.req.path.replace("/mcp-use/public/", "");
      const fullPath = pathHelpers.join(getCwd(), "public", filePath);

      try {
        if (await fsHelpers.existsSync(fullPath)) {
          const content = await fsHelpers.readFile(fullPath);
          const ext = filePath.split(".").pop()?.toLowerCase();
          const contentType =
            ext === "js"
              ? "application/javascript"
              : ext === "css"
                ? "text/css"
                : ext === "png"
                  ? "image/png"
                  : ext === "jpg" || ext === "jpeg"
                    ? "image/jpeg"
                    : ext === "svg"
                      ? "image/svg+xml"
                      : ext === "gif"
                        ? "image/gif"
                        : ext === "webp"
                          ? "image/webp"
                          : ext === "ico"
                            ? "image/x-icon"
                            : ext === "woff" || ext === "woff2"
                              ? "font/woff" + (ext === "woff2" ? "2" : "")
                              : ext === "ttf"
                                ? "font/ttf"
                                : ext === "otf"
                                  ? "font/otf"
                                  : ext === "json"
                                    ? "application/json"
                                    : ext === "pdf"
                                      ? "application/pdf"
                                      : "application/octet-stream";
          return new Response(content, {
            status: 200,
            headers: { "Content-Type": contentType },
          });
        }
        return c.notFound();
      } catch {
        return c.notFound();
      }
    });

    // Add a catch-all 404 handler for widget routes to prevent falling through to other middleware
    // (like the inspector) which might intercept the request and return the wrong content
    this.app.use(`${baseRoute}/*`, async (c) => {
      const url = new URL(c.req.url);
      // Check if it's an asset request
      const isAsset = url.pathname.match(
        /\.(js|css|png|jpg|jpeg|svg|json|ico|woff2?|tsx?)$/i
      );

      // For assets or any unhandled request, return a clean 404
      // This prevents fall-through to inspector middleware
      const message = isAsset ? "Widget asset not found" : "Widget not found";
      return c.text(message, 404);
    });

    widgets.forEach((widget) => {
      console.log(
        `[WIDGET] ${widget.name} mounted at ${baseRoute}/${widget.name}`
      );
    });

    // register a tool and resource for each widget
    for (const widget of widgets) {
      // for now expose all widgets as appsSdk
      const type = "appsSdk";

      // Extract metadata from the widget file using Vite SSR
      let metadata: WidgetMetadata = {};
      let props = {};
      let description = widget.description;

      try {
        const mod = await viteServer.ssrLoadModule(widget.entry);
        if (mod.widgetMetadata) {
          metadata = mod.widgetMetadata;
          description = metadata.description || widget.description;

          // Convert Zod schema to JSON schema for props if available
          if (metadata.inputs) {
            // The inputs is a Zod schema, we can use zodToJsonSchema or extract shape
            try {
              // For now, store the zod schema info
              props = metadata.inputs.shape || {};
            } catch (error) {
              console.warn(
                `[WIDGET] Failed to extract props schema for ${widget.name}:`,
                error
              );
            }
          }
        }
      } catch (error) {
        console.warn(
          `[WIDGET] Failed to load metadata for ${widget.name}:`,
          error
        );
      }

      let html = "";
      try {
        html = await fsHelpers.readFileSync(
          pathHelpers.join(tempDir, widget.name, "index.html"),
          "utf8"
        );
        // Inject or replace base tag with server base URL
        const mcpUrl = this.getServerBaseUrl();
        if (mcpUrl && html) {
          // Remove HTML comments temporarily to avoid matching base tags inside comments
          const htmlWithoutComments = html.replace(/<!--[\s\S]*?-->/g, "");

          // Try to replace existing base tag (only if not in comments)
          const baseTagRegex = /<base\s+[^>]*\/?>/i;
          if (baseTagRegex.test(htmlWithoutComments)) {
            // Find and replace the actual base tag in the original HTML
            const actualBaseTagMatch = html.match(/<base\s+[^>]*\/?>/i);
            if (actualBaseTagMatch) {
              html = html.replace(
                actualBaseTagMatch[0],
                `<base href="${mcpUrl}" />`
              );
            }
          } else {
            // Inject base tag in head if it doesn't exist
            const headTagRegex = /<head[^>]*>/i;
            if (headTagRegex.test(html)) {
              html = html.replace(
                headTagRegex,
                (match) => `${match}\n    <base href="${mcpUrl}" />`
              );
            }
          }
        }

        // Get the base URL with fallback
        const baseUrl = this.getServerBaseUrl();

        // replace relative path that starts with /mcp-use script and css with absolute
        html = html.replace(
          /src="\/mcp-use\/widgets\/([^"]+)"/g,
          `src="${baseUrl}/mcp-use/widgets/$1"`
        );
        html = html.replace(
          /href="\/mcp-use\/widgets\/([^"]+)"/g,
          `href="${baseUrl}/mcp-use/widgets/$1"`
        );

        // add window.__getFile and window.__mcpPublicUrl to head
        html = html.replace(
          /<head[^>]*>/i,
          `<head>\n    <script>window.__getFile = (filename) => { return "${baseUrl}/mcp-use/widgets/${widget.name}/"+filename }; window.__mcpPublicUrl = "${baseUrl}/mcp-use/public";</script>`
        );
      } catch (error) {
        console.error(
          `Failed to read html template for widget ${widget.name}`,
          error
        );
      }

      // // html template is the content of the vite built html
      // const html = await fetch(`${this.serverBaseUrl}/mcp-use/widgets/${widget.name}/index.html`).then(res => res.text())
      // if (!html) {
      //   throw new Error(`Failed to fetch html template for widget ${widget.name}`)
      // }

      const mcp_connect_domain = this.getServerBaseUrl()
        ? new URL(this.getServerBaseUrl() || "").origin
        : null;

      this.uiResource({
        name: widget.name,
        title: metadata.title || widget.name,
        description: description,
        type: type,
        props: props,
        _meta: {
          "mcp-use/widget": {
            name: widget.name,
            title: metadata.title || widget.name,
            description: description,
            type: type,
            props: props,
            html: html,
            dev: true,
          },
          ...(metadata._meta || {}),
        },
        htmlTemplate: html,
        appsSdkMetadata: {
          "openai/widgetDescription": description,
          "openai/toolInvocation/invoking": `Loading ${widget.name}...`,
          "openai/toolInvocation/invoked": `${widget.name} ready`,
          "openai/widgetAccessible": true,
          "openai/resultCanProduceWidget": true,
          ...(metadata.appsSdkMetadata || {}),
          "openai/widgetCSP": {
            connect_domains: [
              // always also add the base url of the server
              ...(mcp_connect_domain ? [mcp_connect_domain] : []),
              ...(metadata.appsSdkMetadata?.["openai/widgetCSP"]
                ?.connect_domains || []),
            ],
            resource_domains: [
              "https://*.oaistatic.com",
              "https://*.oaiusercontent.com",
              // always also add the base url of the server
              ...(mcp_connect_domain ? [mcp_connect_domain] : []),
              // add additional CSP URLs from environment variable
              ...this.getCSPUrls(),
              ...(metadata.appsSdkMetadata?.["openai/widgetCSP"]
                ?.resource_domains || []),
            ],
          },
        },
      });
    }
  }

  /**
   * Mount pre-built widgets from dist/resources/widgets/ directory in production mode
   *
   * Serves static widget bundles that were built using the build command.
   * Sets up Express routes to serve the HTML and asset files, then registers
   * tools and resources for each widget.
   *
   * @private
   * @param options - Configuration options
   * @param options.baseRoute - Base route for widgets (defaults to '/mcp-use/widgets')
   * @returns Promise that resolves when all widgets are mounted
   */
  private async mountWidgetsProduction(options?: {
    baseRoute?: string;
    resourcesDir?: string;
  }): Promise<void> {
    const baseRoute = options?.baseRoute || "/mcp-use/widgets";
    const widgetsDir = pathHelpers.join(
      isDeno ? "." : getCwd(),
      "dist",
      "resources",
      "widgets"
    );

    console.log("widgetsDir", widgetsDir);

    // Setup static file serving routes
    this.setupWidgetRoutes();

    // Discover built widgets from manifest
    const manifestPath = "./dist/mcp-use.json";
    let widgets: string[] = [];
    let widgetsMetadata: Record<string, any> = {};

    try {
      const manifestContent = await fsHelpers.readFileSync(
        manifestPath,
        "utf8"
      );
      const manifest = JSON.parse(manifestContent);

      // Store build ID from manifest for use in widget URIs
      if (manifest.buildId && typeof manifest.buildId === "string") {
        this.buildId = manifest.buildId;
        console.log(`[WIDGETS] Build ID: ${this.buildId}`);
      }

      if (
        manifest.widgets &&
        typeof manifest.widgets === "object" &&
        !Array.isArray(manifest.widgets)
      ) {
        // New format: widgets is an object with widget names as keys and metadata as values
        widgets = Object.keys(manifest.widgets);
        widgetsMetadata = manifest.widgets;
        console.log(
          `[WIDGETS] Loaded ${widgets.length} widget(s) from manifest`
        );
      } else if (manifest.widgets && Array.isArray(manifest.widgets)) {
        // Legacy format: widgets is an array of strings
        widgets = manifest.widgets;
        console.log(
          `[WIDGETS] Loaded ${widgets.length} widget(s) from manifest (legacy format)`
        );
      } else {
        console.log("[WIDGETS] No widgets found in manifest");
      }
    } catch (error) {
      console.log(
        "[WIDGETS] Could not read manifest file, falling back to directory listing:",
        error
      );

      // Fallback to directory listing if manifest doesn't exist
      try {
        const allEntries = await fsHelpers.readdirSync(widgetsDir);
        for (const name of allEntries) {
          const widgetPath = pathHelpers.join(widgetsDir, name);
          const indexPath = pathHelpers.join(widgetPath, "index.html");
          if (await fsHelpers.existsSync(indexPath)) {
            widgets.push(name);
          }
        }
      } catch (dirError) {
        console.log("[WIDGETS] Directory listing also failed:", dirError);
      }
    }

    if (widgets.length === 0) {
      console.log("[WIDGETS] No built widgets found");
      return;
    }

    console.log(
      `[WIDGETS] Serving ${widgets.length} pre-built widget(s) from dist/resources/widgets/`
    );

    // Register tools and resources for each widget
    for (const widgetName of widgets) {
      const widgetPath = pathHelpers.join(widgetsDir, widgetName);
      const indexPath = pathHelpers.join(widgetPath, "index.html");

      // Read the HTML template
      let html = "";
      try {
        html = await fsHelpers.readFileSync(indexPath, "utf8");

        // Inject or replace base tag with server base URL
        const mcpUrl = this.getServerBaseUrl();
        if (mcpUrl && html) {
          // Remove HTML comments temporarily to avoid matching base tags inside comments
          const htmlWithoutComments = html.replace(/<!--[\s\S]*?-->/g, "");

          // Try to replace existing base tag (only if not in comments)
          const baseTagRegex = /<base\s+[^>]*\/?>/i;
          if (baseTagRegex.test(htmlWithoutComments)) {
            // Find and replace the actual base tag in the original HTML
            const actualBaseTagMatch = html.match(/<base\s+[^>]*\/?>/i);
            if (actualBaseTagMatch) {
              html = html.replace(
                actualBaseTagMatch[0],
                `<base href="${mcpUrl}" />`
              );
            }
          } else {
            // Inject base tag in head if it doesn't exist
            const headTagRegex = /<head[^>]*>/i;
            if (headTagRegex.test(html)) {
              html = html.replace(
                headTagRegex,
                (match) => `${match}\n    <base href="${mcpUrl}" />`
              );
            }
          }

          // Get the base URL with fallback (same as mcpUrl, but keeping for clarity)
          const baseUrl = this.getServerBaseUrl();

          // replace relative path that starts with /mcp-use script and css with absolute
          html = html.replace(
            /src="\/mcp-use\/widgets\/([^"]+)"/g,
            `src="${baseUrl}/mcp-use/widgets/$1"`
          );
          html = html.replace(
            /href="\/mcp-use\/widgets\/([^"]+)"/g,
            `href="${baseUrl}/mcp-use/widgets/$1"`
          );

          // add window.__getFile and window.__mcpPublicUrl to head
          html = html.replace(
            /<head[^>]*>/i,
            `<head>\n    <script>window.__getFile = (filename) => { return "${baseUrl}/mcp-use/widgets/${widgetName}/"+filename }; window.__mcpPublicUrl = "${baseUrl}/mcp-use/public";</script>`
          );
        }
      } catch (error) {
        console.error(
          `[WIDGET] Failed to read ${widgetName}/index.html:`,
          error
        );
        continue;
      }

      // Get metadata from manifest
      const metadata: WidgetMetadata = widgetsMetadata[widgetName] || {};
      let props = {};
      let description = `Widget: ${widgetName}`;

      if (metadata.description) {
        description = metadata.description;
      }
      if (metadata.inputs) {
        props = metadata.inputs;
      }

      const mcp_connect_domain = this.getServerBaseUrl()
        ? new URL(this.getServerBaseUrl() || "").origin
        : null;

      console.log("[CSP] mcp_connect_domain", mcp_connect_domain);

      console.log("[CSP] this.getCSPUrls()", this.getCSPUrls());

      console.log("[CSP] metadata.appsSdkMetadata", metadata.appsSdkMetadata);

      console.log("[CSP] metadata._meta", metadata._meta);

      this.uiResource({
        name: widgetName,
        title: metadata.title || widgetName,
        description: description,
        type: "appsSdk",
        props: props,
        _meta: {
          "mcp-use/widget": {
            name: widgetName,
            description: description,
            type: "appsSdk",
            props: props,
            html: html,
            dev: false,
          },
          ...(metadata._meta || {}),
        },
        htmlTemplate: html,
        appsSdkMetadata: {
          "openai/widgetDescription": description,
          "openai/toolInvocation/invoking": `Loading ${widgetName}...`,
          "openai/toolInvocation/invoked": `${widgetName} ready`,
          "openai/widgetAccessible": true,
          "openai/resultCanProduceWidget": true,
          ...(metadata.appsSdkMetadata || {}),
          "openai/widgetCSP": {
            connect_domains: [
              // always also add the base url of the server
              ...(mcp_connect_domain ? [mcp_connect_domain] : []),
              ...(metadata.appsSdkMetadata?.["openai/widgetCSP"]
                ?.connect_domains || []),
            ],
            resource_domains: [
              "https://*.oaistatic.com",
              "https://*.oaiusercontent.com",
              "https://*.openai.com",
              // always also add the base url of the server
              ...(mcp_connect_domain ? [mcp_connect_domain] : []),
              // add additional CSP URLs from environment variable
              ...this.getCSPUrls(),
              ...(metadata.appsSdkMetadata?.["openai/widgetCSP"]
                ?.resource_domains || []),
            ],
          },
        },
      });

      console.log(
        `[WIDGET] ${widgetName} mounted at ${baseRoute}/${widgetName}`
      );
    }
  }

  /**
   * Helper to wait for transport.handleRequest to complete and response to be written
   *
   * Wraps the transport.handleRequest call in a Promise that only resolves when
   * expressRes.end() is called, ensuring all async operations complete before
   * we attempt to read the response.
   *
   * @private
   */
  private waitForRequestComplete(
    transport: any,
    expressReq: any,
    expressRes: any,
    body?: any
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const originalEnd = expressRes.end;
      expressRes.end = (...args: any[]) => {
        originalEnd.apply(expressRes, args);
        resolve();
      };
      transport.handleRequest(expressReq, expressRes, body);
    });
  }

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

    const { StreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/streamableHttp.js"
    );

    const idleTimeoutMs = this.config.sessionIdleTimeoutMs ?? 300000; // Default: 5 minutes

    // Helper to get transport configuration options
    const getTransportConfig = () => {
      const isProduction = this.isProductionMode();
      let allowedOrigins = this.config.allowedOrigins;
      let enableDnsRebindingProtection = false;

      if (isProduction) {
        // Production mode: Only use explicitly configured origins
        if (allowedOrigins !== undefined) {
          enableDnsRebindingProtection = allowedOrigins.length > 0;
        }
        // If not set in production, DNS rebinding protection is disabled
        // (undefined allowedOrigins = no protection)
      } else {
        // Development mode: Allow all origins (disable DNS rebinding protection)
        // This makes it easy to connect from browser dev tools, inspector, etc.
        allowedOrigins = undefined;
        enableDnsRebindingProtection = false;
      }

      return { allowedOrigins, enableDnsRebindingProtection };
    };

    // Helper to create a new transport and session
    const createNewTransport = async (
      closeOldSessionId?: string
    ): Promise<InstanceType<typeof StreamableHTTPServerTransport>> => {
      // Close old session if it exists (cleanup)
      if (closeOldSessionId && this.sessions.has(closeOldSessionId)) {
        try {
          this.sessions.get(closeOldSessionId)!.transport.close();
        } catch (error) {
          // Ignore errors when closing old session
        }
        this.sessions.delete(closeOldSessionId);
      }

      const { allowedOrigins, enableDnsRebindingProtection } =
        getTransportConfig();

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => generateUUID(),
        enableJsonResponse: true,
        allowedOrigins: allowedOrigins,
        enableDnsRebindingProtection: enableDnsRebindingProtection,
        onsessioninitialized: (id) => {
          if (id) {
            this.sessions.set(id, {
              transport,
              lastAccessedAt: Date.now(),
            });
          }
        },
        onsessionclosed: (id) => {
          if (id) {
            this.sessions.delete(id);
          }
        },
      });

      await this.server.connect(transport);
      return transport;
    };

    // Helper to create and auto-initialize a transport for seamless reconnection
    // This is used when autoCreateSessionOnInvalidId is true and client sends
    // a non-initialize request with an invalid/expired session ID
    const createAndAutoInitializeTransport = async (
      oldSessionId: string
    ): Promise<InstanceType<typeof StreamableHTTPServerTransport>> => {
      const { allowedOrigins, enableDnsRebindingProtection } =
        getTransportConfig();

      // Create transport that reuses the OLD session ID
      // This ensures the client's subsequent requests with this session ID will work
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => oldSessionId, // Reuse old session ID!
        enableJsonResponse: true,
        allowedOrigins: allowedOrigins,
        enableDnsRebindingProtection: enableDnsRebindingProtection,
        // We'll manually store the session, so don't rely on onsessioninitialized
        onsessionclosed: (id) => {
          if (id) {
            this.sessions.delete(id);
          }
        },
      });

      await this.server.connect(transport);

      // Manually store the transport with the old session ID BEFORE initialization
      // This ensures subsequent requests find it
      this.sessions.set(oldSessionId, {
        transport,
        lastAccessedAt: Date.now(),
      });

      // Auto-initialize the transport by sending a synthetic initialize request
      // This makes the transport ready to handle other requests
      const initBody = {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mcp-use-auto-reconnect", version: "1.0.0" },
        },
        id: "__auto_init__",
      };

      // Create synthetic Express-like request/response for initialization
      // Must include proper Accept header that the SDK expects
      const syntheticHeaders: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream", // SDK requires both!
      };
      const syntheticReq: any = {
        method: "POST",
        headers: syntheticHeaders,
        header: (name: string) => syntheticHeaders[name.toLowerCase()],
        body: initBody,
      };

      const syntheticRes: any = {
        statusCode: 200,
        setHeader: () => syntheticRes,
        writeHead: (code: number) => {
          syntheticRes.statusCode = code;
          return syntheticRes; // Return this for chaining (e.g., res.writeHead(400).end(...))
        },
        write: () => true,
        end: () => {},
        on: () => syntheticRes,
        once: () => syntheticRes,
        removeListener: () => syntheticRes,
      };

      // Handle the initialize request
      await new Promise<void>((resolve) => {
        syntheticRes.end = () => {
          resolve();
        };
        transport.handleRequest(syntheticReq, syntheticRes, initBody);
      });

      if (syntheticRes.statusCode !== 200) {
        console.error(
          `[MCP] Auto-initialization failed with status ${syntheticRes.statusCode}`
        );
        // Clean up the failed session
        this.sessions.delete(oldSessionId);
        throw new Error(
          `Auto-initialization failed: ${syntheticRes.statusCode}`
        );
      }

      console.log(
        `[MCP] Auto-initialized session ${oldSessionId} for seamless reconnection`
      );
      return transport;
    };

    // Helper to get or create a transport for a session
    const getOrCreateTransport = async (
      sessionId?: string,
      isInit = false
    ): Promise<InstanceType<typeof StreamableHTTPServerTransport> | null> => {
      // For initialize requests, always create a new session (ignore any provided session ID)
      if (isInit) {
        return await createNewTransport(sessionId);
      }

      // For non-init requests, reuse existing transport for session
      if (sessionId && this.sessions.has(sessionId)) {
        const session = this.sessions.get(sessionId)!;
        // Update last accessed time immediately to prevent cleanup during request processing
        session.lastAccessedAt = Date.now();
        return session.transport;
      }

      // For non-init requests with an invalid session ID
      if (sessionId) {
        // Check if auto-create is enabled (default: true for compatibility with non-compliant clients)
        const autoCreate = this.config.autoCreateSessionOnInvalidId ?? true;

        if (autoCreate) {
          // Auto-create AND auto-initialize a new session for seamless reconnection
          // This makes it compatible with non-compliant clients like ChatGPT
          // that don't reinitialize when receiving 404 for invalid session IDs
          console.warn(
            `[MCP] Session ${sessionId} not found (expired or invalid), auto-creating and initializing new session for seamless reconnection`
          );
          return await createAndAutoInitializeTransport(sessionId);
        } else {
          // Follow MCP protocol spec: return null to signal session not found
          // This will result in a 404 error response
          return null;
        }
      }

      // No session ID provided for non-init request
      return null;
    };

    // Start idle cleanup interval if timeout is configured
    if (idleTimeoutMs > 0 && !this.idleCleanupInterval) {
      this.idleCleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [sessionId, session] of this.sessions.entries()) {
          if (now - session.lastAccessedAt > idleTimeoutMs) {
            try {
              session.transport.close();
            } catch (error) {
              // Ignore errors when closing expired sessions
            }
            this.sessions.delete(sessionId);
          }
        }
      }, 60000); // Check every minute
    }

    // Helper to create Express-like req/res from Hono context for MCP SDK
    const createExpressLikeObjects = (c: Context) => {
      const req = c.req.raw;
      const responseBody: Uint8Array[] = [];
      let statusCode = 200;
      const headers: Record<string, string> = {};
      let ended = false;
      let headersSent = false;

      const expressReq: any = {
        ...req,
        url: new URL(req.url).pathname + new URL(req.url).search,
        originalUrl: req.url,
        baseUrl: "",
        path: new URL(req.url).pathname,
        query: Object.fromEntries(new URL(req.url).searchParams),
        params: {},
        body: {},
        headers:
          req.headers && typeof req.headers.entries === "function"
            ? Object.fromEntries(req.headers.entries())
            : (req.headers as any),
        method: req.method,
      };

      const expressRes: any = {
        statusCode: 200,
        headersSent: false,
        status: (code: number) => {
          statusCode = code;
          expressRes.statusCode = code;
          return expressRes;
        },
        setHeader: (name: string, value: string | string[]) => {
          if (!headersSent) {
            headers[name] = Array.isArray(value) ? value.join(", ") : value;
          }
        },
        getHeader: (name: string) => headers[name],
        write: (chunk: any, encoding?: any, callback?: any) => {
          if (!ended) {
            const data =
              typeof chunk === "string"
                ? new TextEncoder().encode(chunk)
                : chunk instanceof Uint8Array
                  ? chunk
                  : Buffer.from(chunk);
            responseBody.push(data);
          }
          if (typeof encoding === "function") {
            encoding();
          } else if (callback) {
            callback();
          }
          return true;
        },
        end: (chunk?: any, encoding?: any, callback?: any) => {
          if (chunk && !ended) {
            const data =
              typeof chunk === "string"
                ? new TextEncoder().encode(chunk)
                : chunk instanceof Uint8Array
                  ? chunk
                  : Buffer.from(chunk);
            responseBody.push(data);
          }
          ended = true;
          if (typeof encoding === "function") {
            encoding();
          } else if (callback) {
            callback();
          }
        },
        on: (event: string, handler: any) => {
          if (event === "close") {
            expressRes._closeHandler = handler;
          }
        },
        once: () => {},
        removeListener: () => {},
        writeHead: (code: number, _headers?: any) => {
          statusCode = code;
          expressRes.statusCode = code;
          headersSent = true;
          if (_headers) {
            Object.assign(headers, _headers);
          }
          return expressRes;
        },
        flushHeaders: () => {
          headersSent = true;
          // For SSE streaming, this is a no-op in our adapter
          // The headers will be sent when the response is returned
        },
        send: (body: any) => {
          if (!ended) {
            expressRes.write(body);
            expressRes.end();
          }
        },
      };

      return {
        expressReq,
        expressRes,
        getResponse: () => {
          if (ended) {
            if (responseBody.length > 0) {
              const body = isDeno
                ? Buffer.concat(responseBody)
                : Buffer.concat(responseBody);
              return new Response(body, {
                status: statusCode,
                headers: headers,
              });
            } else {
              return new Response(null, {
                status: statusCode,
                headers: headers,
              });
            }
          }
          return null;
        },
      };
    };

    // Helper function to mount endpoints for a given path
    const mountEndpoint = (endpoint: string) => {
      // POST endpoint for messages
      this.app.post(endpoint, async (c: Context) => {
        const { expressReq, expressRes, getResponse } =
          createExpressLikeObjects(c);

        // Get request body
        let body: any = {};
        try {
          body = await c.req.json();
          expressReq.body = body;
        } catch {
          expressReq.body = {};
        }

        // Check if this is an initialization request
        const isInit = body?.method === "initialize";
        const sessionId = c.req.header("mcp-session-id");

        // Get or create transport for this session
        const transport = await getOrCreateTransport(sessionId, isInit);

        // Handle missing or invalid session
        if (!transport) {
          if (sessionId) {
            // Session ID was provided but not found (expired or invalid)
            // Per MCP spec: "The server MAY terminate the session at any time, after which
            // it MUST respond to requests containing that session ID with HTTP 404 Not Found."
            // This happens when autoCreateSessionOnInvalidId is false (default behavior)
            return c.json(
              {
                jsonrpc: "2.0",
                error: {
                  code: -32000,
                  message: "Session not found or expired",
                },
                // Notifications don't have an id, but we include null for consistency
                id: body?.id ?? null,
              },
              404
            );
          } else {
            // No session ID for non-init request
            // Per MCP spec: "Servers that require a session ID SHOULD respond to requests
            // without an MCP-Session-Id header (other than initialization) with HTTP 400 Bad Request."
            // For notifications without session ID, we return 202 Accepted if we accept them,
            // or 400 Bad Request if we require session ID. Since we use sessions, we require it.
            return c.json(
              {
                jsonrpc: "2.0",
                error: {
                  code: -32000,
                  message: "Bad Request: Mcp-Session-Id header is required",
                },
                id: body?.id ?? null,
              },
              400
            );
          }
        }

        // Note: lastAccessedAt is already updated in getOrCreateTransport when session is found
        // This redundant update is kept for safety but should not be necessary
        // Also store the request context for this session
        if (sessionId && this.sessions.has(sessionId)) {
          const session = this.sessions.get(sessionId)!;
          session.lastAccessedAt = Date.now();
          session.context = c; // Store the Hono context
        }

        // Handle close event
        if (expressRes._closeHandler) {
          // Note: In web-standard Request/Response, we use AbortController
          // For now, we'll call close when response is done
          c.req.raw.signal?.addEventListener("abort", () => {
            transport.close();
          });
        }

        // Wrap the request handling in AsyncLocalStorage context
        // This makes the Hono context available to tool callbacks via getRequestContext()
        await runWithContext(c, async () => {
          // Wait for handleRequest to complete and for response to be written
          await this.waitForRequestComplete(
            transport,
            expressReq,
            expressRes,
            expressReq.body
          );
        });

        const response = getResponse();
        if (response) {
          return response;
        }

        // If no response was written, return empty response
        return c.text("", 200);
      });

      // GET endpoint for SSE streaming
      this.app.get(endpoint, async (c: Context) => {
        const sessionId = c.req.header("mcp-session-id");

        // Get or create transport for this session
        // GET requests require a session ID (SDK will validate this)
        const transport = await getOrCreateTransport(sessionId, false);

        // Handle missing or invalid session
        if (!transport) {
          if (sessionId) {
            // Session ID was provided but not found (expired or invalid)
            // Per MCP spec: return 404 when session not found
            return c.json(
              {
                jsonrpc: "2.0",
                error: {
                  code: -32000,
                  message: "Session not found or expired",
                },
                id: null,
              },
              404
            );
          } else {
            // No session ID for SSE request
            return c.json(
              {
                jsonrpc: "2.0",
                error: {
                  code: -32000,
                  message: "Bad Request: Mcp-Session-Id header is required",
                },
                id: null,
              },
              400
            );
          }
        }

        // Update last accessed time if session exists
        if (sessionId && this.sessions.has(sessionId)) {
          this.sessions.get(sessionId)!.lastAccessedAt = Date.now();
        }

        // Handle close event
        c.req.raw.signal?.addEventListener("abort", () => {
          transport.close();
        });

        // For streaming, we need to return a Response with a ReadableStream immediately
        // Use globalThis to access TransformStream (available in Node 18+ and modern browsers)
        const { readable, writable } = new (
          globalThis as any
        ).TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Create a promise to track when headers are received
        let resolveResponse: (res: Response) => void;
        const responsePromise = new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        });

        let headersSent = false;
        const headers: Record<string, string> = {};
        let statusCode = 200;

        const expressRes: any = {
          statusCode: 200,
          headersSent: false,
          status: (code: number) => {
            statusCode = code;
            expressRes.statusCode = code;
            return expressRes;
          },
          setHeader: (name: string, value: string | string[]) => {
            if (!headersSent) {
              headers[name] = Array.isArray(value) ? value.join(", ") : value;
            }
          },
          getHeader: (name: string) => headers[name],
          write: (chunk: any) => {
            if (!headersSent) {
              headersSent = true;
              resolveResponse(
                new Response(readable, {
                  status: statusCode,
                  headers,
                })
              );
            }
            const data =
              typeof chunk === "string"
                ? encoder.encode(chunk)
                : chunk instanceof Uint8Array
                  ? chunk
                  : Buffer.from(chunk);
            writer.write(data);
            return true;
          },
          end: (chunk?: any) => {
            if (chunk) {
              expressRes.write(chunk);
            }
            if (!headersSent) {
              headersSent = true;
              // Empty body case
              resolveResponse(
                new Response(null, {
                  status: statusCode,
                  headers,
                })
              );
              writer.close();
            } else {
              writer.close();
            }
          },
          on: (event: string, handler: any) => {
            if (event === "close") {
              expressRes._closeHandler = handler;
            }
          },
          once: () => {},
          removeListener: () => {},
          writeHead: (code: number, _headers?: any) => {
            statusCode = code;
            expressRes.statusCode = code;
            if (_headers) {
              Object.assign(headers, _headers);
            }
            // Don't resolve yet, wait for first write or end?
            // Usually writeHead is followed by write or end
            // If we resolve here, we start the stream
            if (!headersSent) {
              headersSent = true;
              resolveResponse(
                new Response(readable, {
                  status: statusCode,
                  headers,
                })
              );
            }
            return expressRes;
          },
          flushHeaders: () => {
            // No-op - headers are flushed on first write
          },
        };

        // Mock expressReq
        // Hono's c.req.header() returns Record<string, string> which is compatible
        const expressReq: any = {
          ...c.req.raw,
          url: new URL(c.req.url).pathname + new URL(c.req.url).search,
          path: new URL(c.req.url).pathname,
          query: Object.fromEntries(new URL(c.req.url).searchParams),
          headers: c.req.header(),
          method: c.req.method,
        };

        // Note: We don't call this.server.connect() here because the transport
        // is already connected (either from getOrCreateTransport for new transports,
        // or it was already connected when retrieved from the session)

        // Start handling the request
        // We don't await this because it blocks for SSE
        transport.handleRequest(expressReq, expressRes).catch((err) => {
          console.error("MCP Transport error:", err);
          try {
            writer.close();
          } catch {
            // Ignore errors when closing writer
          }
        });

        // Wait for headers to be sent (or timeout?)
        // If handleRequest fails synchronously or writes nothing, this might hang?
        // But MCP transport usually writes headers immediately for SSE
        return responsePromise;
      });

      // DELETE endpoint for session cleanup
      this.app.delete(endpoint, async (c: Context) => {
        const { expressReq, expressRes, getResponse } =
          createExpressLikeObjects(c);

        const sessionId = c.req.header("mcp-session-id");

        // Get transport for this session (DELETE requires session ID)
        // The SDK will handle validation and cleanup via onsessionclosed callback
        const transport = await getOrCreateTransport(sessionId, false);

        // Handle missing or invalid session
        if (!transport) {
          if (sessionId) {
            return c.json(
              {
                jsonrpc: "2.0",
                error: {
                  code: -32000,
                  message: "Session not found or expired",
                },
                id: null,
              },
              404
            );
          } else {
            return c.json(
              {
                jsonrpc: "2.0",
                error: {
                  code: -32000,
                  message: "Bad Request: Mcp-Session-Id header is required",
                },
                id: null,
              },
              400
            );
          }
        }

        // Handle close event
        c.req.raw.signal?.addEventListener("abort", () => {
          transport.close();
        });

        // Wait for handleRequest to complete and for response to be written
        await this.waitForRequestComplete(transport, expressReq, expressRes);

        const response = getResponse();
        if (response) {
          return response;
        }

        return c.text("", 200);
      });
    };

    // Mount endpoints for both /mcp and /sse
    mountEndpoint("/mcp");
    mountEndpoint("/sse");

    this.mcpMounted = true;
    console.log(`[MCP] Server mounted at /mcp and /sse`);
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
    console.log("\n📋 Server exposes:");
    console.log(`   Tools: ${this.registeredTools.length}`);
    if (this.registeredTools.length > 0) {
      this.registeredTools.forEach((name) => {
        console.log(`      - ${name}`);
      });
    }
    console.log(`   Prompts: ${this.registeredPrompts.length}`);
    if (this.registeredPrompts.length > 0) {
      this.registeredPrompts.forEach((name) => {
        console.log(`      - ${name}`);
      });
    }
    console.log(`   Resources: ${this.registeredResources.length}`);
    if (this.registeredResources.length > 0) {
      this.registeredResources.forEach((name) => {
        console.log(`      - ${name}`);
      });
    }
    console.log("");
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
    if (this.oauthConfig && !this.oauthSetupComplete) {
      await this.setupOAuth(this.oauthConfig);
    }

    await this.mountWidgets({
      baseRoute: "/mcp-use/widgets",
      resourcesDir: "resources",
    });
    await this.mountMcp();

    // Mount inspector BEFORE Vite middleware to ensure it handles /inspector routes
    await this.mountInspector();

    // Log registered items before starting server
    this.logRegisteredItems();

    // Start server based on runtime
    if (isDeno) {
      // Define CORS headers for Deno
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      };

      (globalThis as any).Deno.serve(
        { port: this.serverPort, hostname: this.serverHost },
        async (req: Request) => {
          // Handle CORS preflight requests
          if (req.method === "OPTIONS") {
            return new Response("ok", { headers: corsHeaders });
          }

          // Handle Supabase path rewriting
          // Supabase includes the function name in the path (e.g., /functions/v1/mcp-server/mcp or /mcp-server/mcp)
          const url = new URL(req.url);
          const pathname = url.pathname;
          let newPathname = pathname;

          // Match /functions/v1/{anything}/... and strip up to the function name
          const functionsMatch = pathname.match(
            /^\/functions\/v1\/[^/]+(\/.*)?$/
          );
          if (functionsMatch) {
            newPathname = functionsMatch[1] || "/";
          } else {
            // Match /{function-name}/... pattern
            const functionNameMatch = pathname.match(/^\/([^/]+)(\/.*)?$/);
            if (functionNameMatch && functionNameMatch[2]) {
              newPathname = functionNameMatch[2] || "/";
            }
          }

          // Create a new request with the corrected path if needed
          let finalReq = req;
          if (newPathname !== pathname) {
            const newUrl = new URL(newPathname + url.search, url.origin);
            finalReq = new Request(newUrl, {
              method: req.method,
              headers: req.headers,
              body: req.body,
              redirect: req.redirect,
            });
          }

          // Call the app handler
          const response = await this.app.fetch(finalReq);

          // Add CORS headers to the response
          const newHeaders = new Headers(response.headers);
          Object.entries(corsHeaders).forEach(([key, value]) => {
            newHeaders.set(key, value);
          });

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        }
      );
      console.log(`[SERVER] Listening`);
    } else {
      const { serve } = await import("@hono/node-server");
      serve(
        {
          fetch: this.app.fetch,
          port: this.serverPort,
          hostname: this.serverHost,
        },
        (_info: any) => {
          console.log(
            `[SERVER] Listening on http://${this.serverHost}:${this.serverPort}`
          );
          console.log(
            `[MCP] Endpoints: http://${this.serverHost}:${this.serverPort}/mcp and http://${this.serverHost}:${this.serverPort}/sse`
          );
        }
      );
    }
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
    if (this.oauthConfig && !this.oauthSetupComplete) {
      await this.setupOAuth(this.oauthConfig);
    }

    console.log("[MCP] Mounting widgets");
    await this.mountWidgets({
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
        const url = new URL(req.url);
        const pathname = url.pathname;

        // Supabase includes the function name in the path (e.g., /functions/v1/mcp-server/mcp or /mcp-server/mcp)
        // Use regex to detect and strip the function name prefix before /functions or after the function name
        // Pattern: /functions/v1/{function-name}/... or /{function-name}/...
        let newPathname = pathname;

        // Match /functions/v1/{anything}/... and strip up to the function name
        const functionsMatch = pathname.match(
          /^\/functions\/v1\/[^/]+(\/.*)?$/
        );
        if (functionsMatch) {
          // Extract everything after the function name
          newPathname = functionsMatch[1] || "/";
        } else {
          // Match /{function-name}/... pattern (when function name is in path but not /functions)
          // This handles cases where Supabase might pass /mcp-server/mcp
          const functionNameMatch = pathname.match(/^\/([^/]+)(\/.*)?$/);
          if (functionNameMatch && functionNameMatch[2]) {
            // If there's a path after the function name, use it
            // Otherwise, if the path is just /{function-name}, default to /
            newPathname = functionNameMatch[2] || "/";
          }
        }

        // Create a new request with the corrected path
        const newUrl = new URL(newPathname + url.search, url.origin);
        const newReq = new Request(newUrl, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          redirect: req.redirect,
        });

        const result = await fetchHandler(newReq);
        return result;
      };
    }

    return async (req: Request) => {
      const result = await fetchHandler(req);
      return result;
    };
  }

  /**
   * Get array of active session IDs
   *
   * Returns an array of all currently active session IDs. This is useful for
   * sending targeted notifications to specific clients or iterating over
   * connected clients.
   *
   * Note: This only works in stateful mode. In stateless mode (edge environments),
   * this will return an empty array.
   *
   * @returns Array of active session ID strings
   *
   * @example
   * ```typescript
   * const sessions = server.getActiveSessions();
   * console.log(`${sessions.length} clients connected`);
   *
   * // Send notification to first connected client
   * if (sessions.length > 0) {
   *   server.sendNotificationToSession(sessions[0], "custom/hello", { message: "Hi!" });
   * }
   * ```
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Send a notification to all connected clients
   *
   * Broadcasts a JSON-RPC notification to all active sessions. Notifications are
   * one-way messages that do not expect a response from the client.
   *
   * Note: This only works in stateful mode with active sessions. If no sessions
   * are connected, the notification is silently discarded (per MCP spec: "server MAY send").
   *
   * @param method - The notification method name (e.g., "custom/my-notification")
   * @param params - Optional parameters to include in the notification
   *
   * @example
   * ```typescript
   * // Send a simple notification to all clients
   * server.sendNotification("custom/server-status", {
   *   status: "ready",
   *   timestamp: new Date().toISOString()
   * });
   *
   * // Notify all clients that resources have changed
   * server.sendNotification("notifications/resources/list_changed");
   * ```
   */
  async sendNotification(
    method: string,
    params?: Record<string, unknown>
  ): Promise<void> {
    const notification = {
      jsonrpc: "2.0" as const,
      method,
      ...(params && { params }),
    };

    // Send to all active sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      try {
        await session.transport.send(notification);
      } catch (error) {
        console.warn(
          `[MCP] Failed to send notification to session ${sessionId}:`,
          error
        );
      }
    }
  }

  /**
   * Send a notification to a specific client session
   *
   * Sends a JSON-RPC notification to a single client identified by their session ID.
   * This allows sending customized notifications to individual clients.
   *
   * Note: This only works in stateful mode. If the session ID doesn't exist,
   * the notification is silently discarded.
   *
   * @param sessionId - The target session ID (from getActiveSessions())
   * @param method - The notification method name (e.g., "custom/my-notification")
   * @param params - Optional parameters to include in the notification
   * @returns true if the notification was sent, false if session not found
   *
   * @example
   * ```typescript
   * const sessions = server.getActiveSessions();
   *
   * // Send different messages to different clients
   * sessions.forEach((sessionId, index) => {
   *   server.sendNotificationToSession(sessionId, "custom/welcome", {
   *     message: `Hello client #${index + 1}!`,
   *     clientNumber: index + 1
   *   });
   * });
   * ```
   */
  async sendNotificationToSession(
    sessionId: string,
    method: string,
    params?: Record<string, unknown>
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const notification = {
      jsonrpc: "2.0" as const,
      method,
      ...(params && { params }),
    };

    try {
      await session.transport.send(notification);
      return true;
    } catch (error) {
      console.warn(
        `[MCP] Failed to send notification to session ${sessionId}:`,
        error
      );
      return false;
    }
  }

  // Store the roots changed callback
  private onRootsChangedCallback?: (
    roots: Array<{ uri: string; name?: string }>
  ) => void | Promise<void>;

  /**
   * Register a callback for when a client's roots change
   *
   * When a client sends a `notifications/roots/list_changed` notification,
   * the server will automatically request the updated roots list and call
   * this callback with the new roots.
   *
   * @param callback - Function called with the updated roots array
   *
   * @example
   * ```typescript
   * server.onRootsChanged(async (roots) => {
   *   console.log("Client roots updated:", roots);
   *   roots.forEach(root => {
   *     console.log(`  - ${root.name || "unnamed"}: ${root.uri}`);
   *   });
   * });
   * ```
   */
  onRootsChanged(
    callback: (
      roots: Array<{ uri: string; name?: string }>
    ) => void | Promise<void>
  ): this {
    this.onRootsChangedCallback = callback;
    return this;
  }

  /**
   * Request the current roots list from a specific client session
   *
   * This sends a `roots/list` request to the client and returns
   * the list of roots the client has configured.
   *
   * @param sessionId - The session ID of the client to query
   * @returns Array of roots, or null if the session doesn't exist or request fails
   *
   * @example
   * ```typescript
   * const sessions = server.getActiveSessions();
   * if (sessions.length > 0) {
   *   const roots = await server.listRoots(sessions[0]);
   *   if (roots) {
   *     console.log(`Client has ${roots.length} roots:`);
   *     roots.forEach(r => console.log(`  - ${r.uri}`));
   *   }
   * }
   * ```
   */
  async listRoots(
    sessionId: string
  ): Promise<Array<{ uri: string; name?: string }> | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    try {
      // Send roots/list request to the client
      const request = {
        jsonrpc: "2.0" as const,
        id: generateUUID(),
        method: "roots/list",
        params: {},
      };

      // The transport handles the request-response flow
      const response = await session.transport.send(request);

      // The response should contain the roots array
      if (response && typeof response === "object" && "roots" in response) {
        return (response as { roots: Array<{ uri: string; name?: string }> })
          .roots;
      }

      return [];
    } catch (error) {
      console.warn(
        `[MCP] Failed to list roots from session ${sessionId}:`,
        error
      );
      return null;
    }
  }

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

    // In production, only mount if build manifest says so
    if (this.isProductionMode()) {
      const manifest = await this.readBuildManifest();
      if (!manifest?.includeInspector) {
        console.log(
          "[INSPECTOR] Skipped in production (use --with-inspector flag during build)"
        );
        return;
      }
    }

    // Try to dynamically import the inspector package
    // Using dynamic import makes it truly optional - won't fail if not installed

    try {
      // @ts-ignore - Optional peer dependency, may not be installed during build
      const { mountInspector } = await import("@mcp-use/inspector");
      // Auto-connect to the local MCP server at /mcp (SSE endpoint)
      // Use JSON config to specify SSE transport type
      const mcpUrl = `http://${this.serverHost}:${this.serverPort}/mcp`; // Also available at /sse
      const autoConnectConfig = JSON.stringify({
        url: mcpUrl,
        name: "Local MCP Server",
        transportType: "sse",
        connectionType: "Direct",
      });
      mountInspector(this.app, { autoConnectUrl: autoConnectConfig });
      this.inspectorMounted = true;
      console.log(
        `[INSPECTOR] UI available at http://${this.serverHost}:${this.serverPort}/inspector`
      );
    } catch {
      // Inspector package not installed, skip mounting silently
      // This allows the server to work without the inspector in production
    }
  }

  /**
   * Setup default widget serving routes
   *
   * Configures Hono routes to serve MCP UI widgets and their static assets.
   * Widgets are served from the dist/resources/widgets directory and can
   * be accessed via HTTP endpoints for embedding in web applications.
   *
   * Routes created:
   * - GET /mcp-use/widgets/:widget - Serves widget's index.html
   * - GET /mcp-use/widgets/:widget/assets/* - Serves widget-specific assets
   * - GET /mcp-use/widgets/assets/* - Fallback asset serving with auto-discovery
   *
   * @private
   * @returns void
   *
   * @example
   * Widget routes:
   * - http://localhost:3001/mcp-use/widgets/kanban-board
   * - http://localhost:3001/mcp-use/widgets/todo-list/assets/style.css
   * - http://localhost:3001/mcp-use/widgets/assets/script.js (auto-discovered)
   */
  private setupWidgetRoutes(): void {
    // Serve static assets (JS, CSS) from the assets directory
    this.app.get("/mcp-use/widgets/:widget/assets/*", async (c: Context) => {
      const widget = c.req.param("widget");
      const assetFile = c.req.path.split("/assets/")[1];
      const assetPath = pathHelpers.join(
        getCwd(),
        "dist",
        "resources",
        "widgets",
        widget,
        "assets",
        assetFile
      );

      try {
        if (await fsHelpers.existsSync(assetPath)) {
          const content = await fsHelpers.readFile(assetPath);
          // Determine content type based on file extension
          const ext = assetFile.split(".").pop()?.toLowerCase();
          const contentType =
            ext === "js"
              ? "application/javascript"
              : ext === "css"
                ? "text/css"
                : ext === "png"
                  ? "image/png"
                  : ext === "jpg" || ext === "jpeg"
                    ? "image/jpeg"
                    : ext === "svg"
                      ? "image/svg+xml"
                      : "application/octet-stream";
          return new Response(content, {
            status: 200,
            headers: { "Content-Type": contentType },
          });
        }
        return c.notFound();
      } catch {
        return c.notFound();
      }
    });

    // Handle assets served from the wrong path (browser resolves ./assets/ relative to /mcp-use/widgets/)
    this.app.get("/mcp-use/widgets/assets/*", async (c: Context) => {
      const assetFile = c.req.path.split("/assets/")[1];
      // Try to find which widget this asset belongs to by checking all widget directories
      const widgetsDir = pathHelpers.join(
        getCwd(),
        "dist",
        "resources",
        "widgets"
      );

      try {
        const widgets = await fsHelpers.readdirSync(widgetsDir);
        for (const widget of widgets) {
          const assetPath = pathHelpers.join(
            widgetsDir,
            widget,
            "assets",
            assetFile
          );
          if (await fsHelpers.existsSync(assetPath)) {
            const content = await fsHelpers.readFile(assetPath);
            const ext = assetFile.split(".").pop()?.toLowerCase();
            const contentType =
              ext === "js"
                ? "application/javascript"
                : ext === "css"
                  ? "text/css"
                  : ext === "png"
                    ? "image/png"
                    : ext === "jpg" || ext === "jpeg"
                      ? "image/jpeg"
                      : ext === "svg"
                        ? "image/svg+xml"
                        : "application/octet-stream";
            return new Response(content, {
              status: 200,
              headers: { "Content-Type": contentType },
            });
          }
        }
        return c.notFound();
      } catch {
        return c.notFound();
      }
    });

    // Serve each widget's index.html at its route
    // e.g. GET /mcp-use/widgets/kanban-board -> dist/resources/widgets/kanban-board/index.html
    this.app.get("/mcp-use/widgets/:widget", async (c: Context) => {
      const widget = c.req.param("widget");
      const filePath = pathHelpers.join(
        getCwd(),
        "dist",
        "resources",
        "widgets",
        widget,
        "index.html"
      );

      try {
        let html = await fsHelpers.readFileSync(filePath, "utf8");

        // Get the base URL with fallback
        const baseUrl = this.getServerBaseUrl();

        // replace relative path that starts with /mcp-use script and css with absolute
        html = html.replace(
          /src="\/mcp-use\/widgets\/([^"]+)"/g,
          `src="${baseUrl}/mcp-use/widgets/$1"`
        );
        html = html.replace(
          /href="\/mcp-use\/widgets\/([^"]+)"/g,
          `href="${baseUrl}/mcp-use/widgets/$1"`
        );

        // add window.__getFile to head
        html = html.replace(
          /<head[^>]*>/i,
          `<head>\n    <script>window.__getFile = (filename) => { return "${baseUrl}/mcp-use/widgets/${widget}/"+filename }</script>`
        );

        return c.html(html);
      } catch {
        return c.notFound();
      }
    });

    // Serve static files from public directory
    this.app.get("/mcp-use/public/*", async (c: Context) => {
      const filePath = c.req.path.replace("/mcp-use/public/", "");
      const fullPath = pathHelpers.join(getCwd(), "dist", "public", filePath);

      try {
        if (await fsHelpers.existsSync(fullPath)) {
          const content = await fsHelpers.readFile(fullPath);
          const ext = filePath.split(".").pop()?.toLowerCase();
          const contentType =
            ext === "js"
              ? "application/javascript"
              : ext === "css"
                ? "text/css"
                : ext === "png"
                  ? "image/png"
                  : ext === "jpg" || ext === "jpeg"
                    ? "image/jpeg"
                    : ext === "svg"
                      ? "image/svg+xml"
                      : ext === "gif"
                        ? "image/gif"
                        : ext === "webp"
                          ? "image/webp"
                          : ext === "ico"
                            ? "image/x-icon"
                            : ext === "woff" || ext === "woff2"
                              ? "font/woff" + (ext === "woff2" ? "2" : "")
                              : ext === "ttf"
                                ? "font/ttf"
                                : ext === "otf"
                                  ? "font/otf"
                                  : ext === "json"
                                    ? "application/json"
                                    : ext === "pdf"
                                      ? "application/pdf"
                                      : "application/octet-stream";
          return new Response(content, {
            status: 200,
            headers: { "Content-Type": contentType },
          });
        }
        return c.notFound();
      } catch {
        return c.notFound();
      }
    });
  }

  /**
   * Convert a Zod object schema to the internal Record<string, z.ZodSchema> format
   *
   * @param zodSchema - Zod object schema to convert
   * @returns Object mapping parameter names to Zod validation schemas
   */
  private convertZodSchemaToParams(
    zodSchema: z.ZodObject<any>
  ): Record<string, z.ZodSchema> {
    // Validate that it's a ZodObject
    if (!(zodSchema instanceof z.ZodObject)) {
      throw new Error("schema must be a Zod object schema (z.object({...}))");
    }

    // Extract the shape from the Zod object schema
    const shape = zodSchema.shape;
    const params: Record<string, z.ZodSchema> = {};

    // Convert each property in the shape
    for (const [key, value] of Object.entries(shape)) {
      params[key] = value as z.ZodSchema;
    }

    return params;
  }

  /**
   * Create input schema for tools
   *
   * Converts tool input definitions into Zod validation schemas for runtime validation.
   * Supports common data types (string, number, boolean, object, array) and optional
   * parameters. Used internally when registering tools with the MCP server.
   *
   * @param inputs - Array of input parameter definitions with name, type, and optional flag
   * @returns Object mapping parameter names to Zod validation schemas
   *
   * @example
   * ```typescript
   * const schema = this.createParamsSchema([
   *   { name: 'query', type: 'string', required: true, description: 'Search query' },
   *   { name: 'limit', type: 'number', required: false }
   * ])
   * // Returns: { query: z.string().describe('Search query'), limit: z.number().optional() }
   * ```
   */
  private createParamsSchema(
    inputs: Array<{
      name: string;
      type: string;
      required?: boolean;
      description?: string;
    }>
  ): Record<string, z.ZodSchema> {
    const schema: Record<string, z.ZodSchema> = {};

    inputs.forEach((input) => {
      let zodType: z.ZodSchema;
      switch (input.type) {
        case "string":
          zodType = z.string();
          break;
        case "number":
          zodType = z.number();
          break;
        case "boolean":
          zodType = z.boolean();
          break;
        case "object":
          zodType = z.object({});
          break;
        case "array":
          zodType = z.array(z.any());
          break;
        default:
          zodType = z.any();
      }

      // Add description if provided
      if (input.description) {
        zodType = zodType.describe(input.description);
      }

      if (!input.required) {
        zodType = zodType.optional();
      }

      schema[input.name] = zodType;
    });

    return schema;
  }

  /**
   * Parse parameter values from a URI based on a template
   *
   * Extracts parameter values from an actual URI by matching it against a URI template.
   * The template contains placeholders like {param} which are extracted as key-value pairs.
   *
   * @param template - URI template with placeholders (e.g., "user://{userId}/posts/{postId}")
   * @param uri - Actual URI to parse (e.g., "user://123/posts/456")
   * @returns Object mapping parameter names to their values
   *
   * @example
   * ```typescript
   * const params = this.parseTemplateUri("user://{userId}/posts/{postId}", "user://123/posts/456")
   * // Returns: { userId: "123", postId: "456" }
   * ```
   */
  private parseTemplateUri(
    template: string,
    uri: string
  ): Record<string, string> {
    const params: Record<string, string> = {};

    // Convert template to a regex pattern
    // Escape special regex characters except {}
    let regexPattern = template.replace(/[.*+?^$()[\]\\|]/g, "\\$&");

    // Replace {param} with named capture groups
    const paramNames: string[] = [];
    regexPattern = regexPattern.replace(/\\\{([^}]+)\\\}/g, (_, paramName) => {
      paramNames.push(paramName);
      return "([^/]+)";
    });

    const regex = new RegExp(`^${regexPattern}$`);
    const match = uri.match(regex);

    if (match) {
      paramNames.forEach((paramName, index) => {
        params[paramName] = match[index + 1];
      });
    }

    return params;
  }
}

export type McpServerInstance<HasOAuth extends boolean = false> = Omit<
  McpServer<HasOAuth>,
  keyof HonoType
> &
  HonoType & {
    getHandler: (options?: {
      provider?: "supabase" | "cloudflare" | "deno-deploy";
    }) => Promise<(req: Request) => Promise<Response>>;
  };

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
): McpServerInstance<true>;

// Overload: when OAuth is not configured
// eslint-disable-next-line no-redeclare
export function createMCPServer(
  name: string,
  config?: Partial<ServerConfig>
): McpServerInstance<false>;

// Implementation
// eslint-disable-next-line no-redeclare
export function createMCPServer(
  name: string,
  config: Partial<ServerConfig> = {}
): McpServerInstance<boolean> {
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

  return instance as unknown as McpServerInstance<boolean>;
}
