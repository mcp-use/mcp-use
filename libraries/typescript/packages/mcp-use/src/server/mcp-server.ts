import {
  McpServer as OfficialMcpServer,
  ResourceTemplate,
  type RegisteredPrompt,
  type RegisteredResource,
  type RegisteredResourceTemplate,
  type RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { Hono as HonoType } from "hono";
import { z } from "zod";
import { Telemetry } from "../telemetry/index.js";
import { getPackageVersion } from "../version.js";

import { countChanges, logChanges, syncPrimitive } from "./hmr-sync.js";
import { mountInspectorUI } from "./inspector/index.js";
import { registerPrompt } from "./prompts/index.js";
import {
  registerResource,
  registerResourceTemplate,
  ResourceSubscriptionManager,
} from "./resources/index.js";
import {
  convertZodSchemaToParams,
  createParamsSchema,
  toolRegistration,
} from "./tools/index.js";
import { AppsSdkAdapter, McpAppsAdapter } from "./widgets/adapters/index.js";
import {
  mountWidgets,
  setupFaviconRoute,
  setupPublicRoutes,
  uiResourceRegistration,
} from "./widgets/index.js";
import { generateWidgetUri } from "./widgets/widget-helpers.js";
import { toResourceTemplateCompleteCallbacks } from "./utils/completion-helpers.js";

// Import and re-export tool context types for public API
import type {
  ElicitFormParams,
  ElicitOptions,
  ElicitUrlParams,
  SampleOptions,
  ToolContext,
} from "./types/tool-context.js";

export type {
  ElicitFormParams,
  ElicitOptions,
  ElicitUrlParams,
  SampleOptions,
  ToolContext,
};

import { getRequestContext, runWithContext } from "./context-storage.js";
import { mountMcp as mountMcpHelper } from "./endpoints/index.js";
import { requestLogger } from "./logging.js";
import {
  getActiveSessions,
  sendNotification,
  sendNotificationToSession,
  sendPromptsListChanged,
  sendResourcesListChanged,
  sendToolsListChanged,
} from "./notifications/index.js";
import type { OAuthProvider } from "./oauth/providers/types.js";
import { setupOAuthForServer } from "./oauth/setup.js";
import { listRoots, onRootsChanged } from "./roots/index.js";
import type { SessionData } from "./sessions/index.js";
import {
  createEnhancedContext,
  findSessionContext,
  isValidLogLevel,
} from "./tools/tool-execution-helpers.js";
import type { ServerConfig } from "./types/index.js";
import type { PromptCallback, PromptDefinition } from "./types/prompt.js";
import type {
  ReadResourceCallback,
  ReadResourceTemplateCallback,
  ResourceDefinition,
  ResourceTemplateDefinition,
  ResourceTemplateCallbacks,
} from "./types/resource.js";
import type {
  InferToolInput,
  InferToolOutput,
  ToolCallback,
  ToolDefinition,
} from "./types/tool.js";
import {
  applyDenoCorsHeaders,
  createHonoApp,
  createHonoProxy,
  installCustomRoutesMiddleware,
  getDenoCorsHeaders,
  getEnv,
  getServerBaseUrl as getServerBaseUrlHelper,
  isDeno,
  isProductionMode as isProductionModeHelper,
  logRegisteredItems as logRegisteredItemsHelper,
  parseTemplateUri as parseTemplateUriHelper,
  rewriteSupabaseRequest,
  startServer,
} from "./utils/index.js";

/**
 * Validates that a key is safe to use as a property name to prevent prototype pollution.
 * Returns true if the key is safe, false if it could lead to prototype pollution.
 *
 * @param key - The property key to validate
 * @returns true if the key is safe to use, false otherwise
 */
function isSafePropertyKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

/**
 * Auto-selects a favicon from the icons array based on priority.
 *
 * Priority order:
 * 1. .ico files (native favicon format)
 * 2. Small PNG files (16x16, 32x32) - typical favicon sizes
 * 3. Any PNG file
 * 4. First icon in the array (fallback)
 *
 * @param icons - Array of icon definitions from ServerConfig
 * @returns The src path of the selected icon
 */
function selectFaviconFromIcons(
  icons: Array<{ src: string; mimeType?: string; sizes?: string[] }>
): string {
  // Priority 1: .ico files
  const icoIcon = icons.find((icon) => icon.src.endsWith(".ico"));
  if (icoIcon) return icoIcon.src;

  // Priority 2: Small PNG files (16x16, 32x32)
  const smallPng = icons.find(
    (icon) =>
      icon.src.endsWith(".png") &&
      icon.sizes?.some((size) => size === "16x16" || size === "32x32")
  );
  if (smallPng) return smallPng.src;

  // Priority 3: Any PNG
  const pngIcon = icons.find((icon) => icon.src.endsWith(".png"));
  if (pngIcon) return pngIcon.src;

  // Fallback: First icon
  return icons[0].src;
}

/**
 * MCP Server class
 *
 * MCPServerClass provides a complete MCP (Model Context Protocol) server implementation
 * built on top of the Hono web framework. It combines MCP protocol handling with HTTP
 * server capabilities, making it easy to build tools, resources, and prompts that can
 * be accessed by MCP clients.
 * The server can be run as a standalone HTTP server or integrated into existing
 * applications (Cloudflare Workers, Vercel Edge Functions, etc.) using {@link getHandler}.
 *
 * @typeParam HasOAuth - Type parameter indicating if OAuth is configured
 *
 * @example
 * ```typescript
 * // Basic server setup
 * const server = new MCPServer({
 *   name: 'my-server',
 *   version: '1.0.0'
 * });
 *
 * // Register a tool
 * server.tool({
 *   name: 'add',
 *   description: 'Add two numbers',
 *   schema: z.object({
 *     a: z.number(),
 *     b: z.number()
 *   })
 * }, async ({ a, b }) => {
 *   return { content: [{ type: 'text', text: String(a + b) }] };
 * });
 *
 * // Start the server
 * await server.listen(3000);
 * ```
 *
 * @example
 * ```typescript
 * // With OAuth authentication
 * const server = new MCPServer({
 *   name: 'secure-server',
 *   version: '1.0.0',
 *   oauth: oauthAuth0Provider({
 *     clientId: process.env.AUTH0_CLIENT_ID!,
 *     clientSecret: process.env.AUTH0_CLIENT_SECRET!,
 *     domain: process.env.AUTH0_DOMAIN!
 *   })
 * });
 *
 * server.tool({
 *   name: 'protected-action',
 *   description: 'Requires authentication'
 * }, async (params, ctx) => {
 *   const auth = ctx.auth; // OAuth user info available
 *   return text(`Hello, ${auth.user.email}`);
 * });
 * ```
 *
 * @see {@link MCPClient} for connecting to MCP servers
 * @see {@link tool} for registering tools
 * @see {@link resource} for serving resources
 * @see {@link prompt} for defining prompts
 */
class MCPServerClass<HasOAuth extends boolean = false> {
  /**
   * Gets the mcp-use package version.
   *
   * @returns The package version string (e.g., "1.13.2")
   *
   * @example
   * ```typescript
   * console.log(`Server version: ${MCPServer.getPackageVersion()}`);
   * ```
   */
  public static getPackageVersion(): string {
    return getPackageVersion();
  }

  /**
   * Native MCP server instance from the official SDK.
   *
   * This is the underlying server from `@modelcontextprotocol/sdk` that handles
   * the MCP protocol. Exposed publicly for advanced use cases that need direct
   * access to SDK functionality.
   *
   * @example
   * ```typescript
   * // Access native SDK methods
   * server.nativeServer.server.setRequestHandler(...);
   * ```
   */
  public readonly nativeServer: OfficialMcpServer;

  /**
   * @deprecated Use {@link nativeServer} instead.
   * Kept for backward compatibility with older code.
   */
  public get server(): OfficialMcpServer {
    return this.nativeServer;
  }

  /**
   * Server configuration including name, version, OAuth settings, etc.
   */
  public config: ServerConfig;

  /**
   * Hono application instance.
   *
   * The underlying Hono app that handles HTTP routing and middleware.
   * Can be used to add custom routes and middleware alongside MCP endpoints.
   *
   * @example
   * ```typescript
   * // Add custom HTTP endpoint
   * server.app.get('/health', (c) => c.json({ status: 'ok' }));
   * ```
   */
  public app: HonoType;

  /** @internal Whether MCP endpoints have been mounted */
  private mcpMounted = false;

  /** @internal Whether inspector UI has been mounted */
  private inspectorMounted = false;

  /** @internal Whether public routes have been set up and in what mode */
  private publicRoutesMode: "dev" | "production" | null = null;

  /**
   * @internal Mutable registry of custom HTTP route handlers for HMR support.
   * Key format: "METHOD:PATH" (e.g., "get:/api/fruits")
   * Handlers are stored here so they can be swapped during HMR without
   * re-registering routes on the immutable Hono router.
   */

  public _customRoutes = new Map<string, ((...args: any[]) => any)[]>();

  /**
   * Port number the server is listening on (set after calling {@link listen}).
   */
  public serverPort?: number;

  /**
   * Hostname the server is bound to (default: "localhost").
   */
  public serverHost: string;

  /**
   * Full base URL for the server (e.g., "https://example.com").
   * Used for generating widget URLs and OAuth callbacks.
   */
  public serverBaseUrl?: string;

  /**
   * Optional favicon URL to display in inspector and documentation.
   */
  public favicon?: string;

  /**
   * List of registered tool names.
   */
  public registeredTools: string[] = [];

  /**
   * List of registered prompt names.
   */
  public registeredPrompts: string[] = [];

  /**
   * List of registered resource URIs.
   */
  public registeredResources: string[] = [];

  /**
   * Optional build identifier for cache busting widget URLs.
   * @internal
   */
  public buildId?: string;

  /**
   * Map of active client sessions.
   * Each session represents a connected MCP client with its own server instance.
   */
  public sessions = new Map<string, SessionData>();
  private idleCleanupInterval?: NodeJS.Timeout;
  private oauthSetupState = {
    complete: false,
    provider: undefined as OAuthProvider | undefined,
    middleware: undefined as
      | ((c: any, next: any) => Promise<Response | void>)
      | undefined,
  };
  public oauthProvider?: OAuthProvider;
  private oauthMiddleware?: (c: any, next: any) => Promise<Response | void>;

  /**
   * Storage for registrations that can be replayed on new server instances
   * Following the official SDK pattern where each session gets its own server instance
   * @internal Exposed for telemetry purposes
   */
  public registrations = {
    tools: new Map<string, { config: ToolDefinition; handler: ToolCallback }>(),
    prompts: new Map<
      string,
      { config: PromptDefinition; handler: PromptCallback }
    >(),
    resources: new Map<
      string,
      { config: ResourceDefinition; handler: ReadResourceCallback }
    >(),
    resourceTemplates: new Map<
      string,
      {
        config: ResourceTemplateDefinition;
        handler: ReadResourceTemplateCallback;
      }
    >(),
  };

  /**
   * Storage for widget definitions, used to inject metadata into tool responses
   * when using the widget() helper with returnsWidget option
   */
  public widgetDefinitions = new Map<string, Record<string, unknown>>();

  /**
   * Storage for SDK-registered tool/prompt/resource references per session.
   * These refs have update() and remove() methods for hot reloading.
   * @internal Used for HMR in development mode
   */
  public sessionRegisteredRefs = new Map<
    string,
    {
      tools: Map<string, RegisteredTool>;
      prompts: Map<string, RegisteredPrompt>;
      resources: Map<string, RegisteredResource>;
      resourceTemplates: Map<string, RegisteredResourceTemplate>;
    }
  >();

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
   * Clean up registered refs for a closed session
   *
   * This method is called automatically when a session is closed to remove
   * all registered tool/prompt/resource refs associated with that session.
   *
   * @param sessionId - The session ID to clean up
   * @internal
   */
  public cleanupSessionRefs(sessionId: string): void {
    this.sessionRegisteredRefs.delete(sessionId);
  }

  /**
   * Add a new widget tool directly to all active sessions (for HMR)
   *
   * This method adds a widget tool to all active sessions' internal state
   * immediately, ensuring the tool is queryable before notifications are sent.
   * This prevents race conditions where clients fetch tools before registration completes.
   *
   * Also registers the associated widget resources (static and template) for Apps SDK widgets.
   *
   * @param toolDefinition - The tool definition
   * @param toolCallback - The tool callback function
   * @internal
   */
  public addWidgetTool(toolDefinition: any, toolCallback: any): void {
    // Guard against prototype pollution
    if (!isSafePropertyKey(toolDefinition.name)) {
      console.warn(
        `[MCP-Server] Rejected potentially malicious tool name: ${toolDefinition.name}`
      );
      return;
    }

    console.log(
      `[MCP-Server] Adding widget tool directly to sessions: ${toolDefinition.name}`
    );

    // First register normally to update wrapper's registrations
    (this.tool as any)(toolDefinition, toolCallback);

    const widgetName = toolDefinition.name;

    // Get resource registrations for this widget
    // Resources are stored with key format "name:uri"
    const resourceUri = generateWidgetUri(widgetName, this.buildId, ".html");
    const resourceTemplateUri = generateWidgetUri(
      widgetName,
      this.buildId,
      ".html",
      "{id}"
    );
    const resourceKey = `${widgetName}:${resourceUri}`;
    // Resource templates are stored by name only (no URI suffix)
    const resourceTemplateKey = `${widgetName}-dynamic`;
    const resourceReg = this.registrations.resources.get(resourceKey);
    const resourceTemplateReg =
      this.registrations.resourceTemplates.get(resourceTemplateKey);

    // Then immediately add to each session's native _registeredTools and _registeredResources
    // This ensures the tool and resources are queryable before notifications are sent
    for (const [sessionId, session] of this.sessions) {
      if (!session.server) continue;
      const nativeServer = session.server as any;

      // Get the registered tool from wrapper (which has the converted schema)
      const registration = this.registrations.tools.get(toolDefinition.name);
      if (!registration) {
        console.warn(
          `[MCP-Server] Tool ${toolDefinition.name} not found in wrapper registrations!`
        );
        continue;
      }

      // Convert schema to inputSchema if needed
      let inputSchema: Record<string, unknown>;
      if (registration.config.schema) {
        try {
          inputSchema = this.convertZodSchemaToParams(
            registration.config.schema as any
          );
        } catch (e) {
          console.warn(
            `[MCP-Server] Failed to convert schema for ${toolDefinition.name}`
          );
          inputSchema = {};
        }
      } else if (
        registration.config.inputs &&
        registration.config.inputs.length > 0
      ) {
        inputSchema = this.createParamsSchema(
          registration.config.inputs as any
        );
      } else {
        inputSchema = {};
      }

      // Create a proper tool entry with all required fields including the handler
      const toolEntry = {
        title: registration.config.title,
        description: registration.config.description ?? "",
        inputSchema: inputSchema,
        outputSchema: undefined,
        annotations: registration.config.annotations,
        execution: { taskSupport: "forbidden" as const },
        _meta: registration.config._meta,
        handler: registration.handler,
        enabled: true,
        disable: function (this: any) {
          this.enabled = false;
        },
        enable: function (this: any) {
          this.enabled = true;
        },
        remove: () => {
          // Guard against prototype pollution
          if (!isSafePropertyKey(toolDefinition.name)) {
            console.warn(
              `[MCP-Server] Rejected potentially malicious tool name in remove: ${toolDefinition.name}`
            );
            return;
          }
          delete nativeServer._registeredTools[toolDefinition.name];
        },
        update: function (this: any, updates: Record<string, unknown>) {
          Object.assign(this, updates);
        },
      };

      // Add directly to SDK's _registeredTools for this session
      if (nativeServer._registeredTools) {
        nativeServer._registeredTools[toolDefinition.name] = toolEntry;
        console.log(
          `[MCP-Server] Added tool ${toolDefinition.name} to session ${sessionId}'s _registeredTools`
        );
      }

      // Add widget resources to this session (skip if already propagated)
      const sessionRefs = this.sessionRegisteredRefs.get(sessionId);
      if (resourceReg && session.server) {
        if (sessionRefs?.resources?.has(resourceKey)) {
          // Already registered by propagateWidgetResourcesToSessions
        } else {
          try {
            const registered = session.server.registerResource(
              resourceReg.config.name,
              resourceReg.config.uri,
              {
                title: resourceReg.config.title,
                description: resourceReg.config.description,
                mimeType: resourceReg.config.mimeType || "text/html+skybridge",
              } as any,
              resourceReg.handler as any
            );
            if (sessionRefs?.resources) {
              sessionRefs.resources.set(resourceKey, registered);
            }
            console.log(
              `[MCP-Server] Added resource ${resourceUri} to session ${sessionId}`
            );
          } catch (e) {
            console.warn(
              `[MCP-Server] Failed to register resource ${resourceUri} for session ${sessionId}:`,
              e
            );
          }
        }
      }

      // Add widget resource template to this session (skip if already propagated)
      if (resourceTemplateReg && session.server) {
        if (sessionRefs?.resourceTemplates?.has(resourceTemplateKey)) {
          // Already registered by propagateWidgetResourcesToSessions
        } else {
          try {
            const uriTemplate =
              resourceTemplateReg.config.resourceTemplate.uriTemplate;
            const resourceCallbacks =
              resourceTemplateReg.config.resourceTemplate.callbacks;
            const template = new ResourceTemplate(uriTemplate, {
              list: undefined,
              complete: toResourceTemplateCompleteCallbacks(
                resourceCallbacks?.complete
              ),
            });

            const registered = session.server.registerResource(
              resourceTemplateReg.config.name,
              template,
              {
                title: resourceTemplateReg.config.title,
                description: resourceTemplateReg.config.description,
                mimeType:
                  resourceTemplateReg.config.resourceTemplate.mimeType ||
                  "text/html+skybridge",
              } as any,
              resourceTemplateReg.handler as any
            );
            if (sessionRefs?.resourceTemplates) {
              sessionRefs.resourceTemplates.set(
                resourceTemplateKey,
                registered as unknown as RegisteredResourceTemplate
              );
            }
            console.log(
              `[MCP-Server] Added resource template ${resourceTemplateUri} to session ${sessionId}`
            );
          } catch (e) {
            console.warn(
              `[MCP-Server] Failed to register resource template ${resourceTemplateUri} for session ${sessionId}:`,
              e
            );
          }
        }
      }
    }

    // Send notifications AFTER adding to all sessions
    for (const [sessionId, session] of this.sessions) {
      // Send tool list changed notification
      if (session.server?.sendToolListChanged) {
        try {
          session.server.sendToolListChanged();
          console.log(
            `[MCP-Server] Sent tools notification to session ${sessionId}`
          );
        } catch (e) {
          console.debug(
            `[MCP-Server] Session ${sessionId}: Failed to send tools notification`
          );
        }
      }
      // Send resource list changed notification if resources were added
      if (
        (resourceReg || resourceTemplateReg) &&
        session.server?.sendResourceListChanged
      ) {
        try {
          session.server.sendResourceListChanged();
          console.log(
            `[MCP-Server] Sent resources notification to session ${sessionId}`
          );
        } catch (e) {
          console.debug(
            `[MCP-Server] Session ${sessionId}: Failed to send resources notification`
          );
        }
      }
    }
  }

  /**
   * Propagate widget resources (static + template) to all existing sessions.
   *
   * Called from uiResourceRegistration after resource/resourceTemplate have been
   * added to wrapper-level registrations. This ensures existing sessions see
   * newly discovered widgets without requiring a reconnect, even when the widget
   * does not expose an auto-generated tool (exposeAsTool=false).
   *
   * @param widgetName - Name of the widget whose resources should be pushed
   * @internal
   */
  public propagateWidgetResourcesToSessions(widgetName: string): void {
    const resourceUri = generateWidgetUri(widgetName, this.buildId, ".html");
    const resourceKey = `${widgetName}:${resourceUri}`;
    const resourceReg = this.registrations.resources.get(resourceKey);

    const resourceTemplateUri = generateWidgetUri(
      widgetName,
      this.buildId,
      ".html",
      "{id}"
    );
    // Resource templates are stored by name only (no URI suffix)
    const resourceTemplateKey = `${widgetName}-dynamic`;
    const resourceTemplateReg =
      this.registrations.resourceTemplates.get(resourceTemplateKey);

    if (!resourceReg && !resourceTemplateReg) return;

    for (const [sessionId, session] of this.sessions) {
      if (!session.server) continue;

      // Get session refs for tracking (ensures syncPrimitive can track these during HMR)
      const sessionRefs = this.sessionRegisteredRefs.get(sessionId);

      // Add static resource
      if (resourceReg) {
        try {
          const registered = session.server.registerResource(
            resourceReg.config.name,
            resourceReg.config.uri,
            {
              title: resourceReg.config.title,
              description: resourceReg.config.description,
              mimeType: resourceReg.config.mimeType || "text/html+skybridge",
            } as any,
            resourceReg.handler as any
          );
          // Track in session refs so syncPrimitive preserves it during HMR
          if (sessionRefs?.resources) {
            sessionRefs.resources.set(resourceKey, registered);
          }
          console.log(
            `[MCP-Server] Propagated resource ${resourceUri} to session ${sessionId}`
          );
        } catch (_e) {
          // Resource may already be registered by addWidgetTool
        }
      }

      // Add resource template
      if (resourceTemplateReg) {
        try {
          const uriTemplate =
            resourceTemplateReg.config.resourceTemplate.uriTemplate;
          const resourceCallbacks =
            resourceTemplateReg.config.resourceTemplate.callbacks;
          const template = new ResourceTemplate(uriTemplate, {
            list: undefined,
            complete: toResourceTemplateCompleteCallbacks(
              resourceCallbacks?.complete
            ),
          });

          const registered = session.server.registerResource(
            resourceTemplateReg.config.name,
            template,
            {
              title: resourceTemplateReg.config.title,
              description: resourceTemplateReg.config.description,
              mimeType:
                resourceTemplateReg.config.resourceTemplate.mimeType ||
                "text/html+skybridge",
            } as any,
            resourceTemplateReg.handler as any
          );
          // Track in session refs so syncPrimitive preserves it during HMR
          if (sessionRefs?.resourceTemplates) {
            sessionRefs.resourceTemplates.set(
              resourceTemplateKey,
              registered as unknown as RegisteredResourceTemplate
            );
          }
          console.log(
            `[MCP-Server] Propagated resource template ${resourceTemplateUri} to session ${sessionId}`
          );
        } catch (_e) {
          // Resource template may already be registered by addWidgetTool
        }
      }

      // Send resource list changed notification
      if (session.server?.sendResourceListChanged) {
        try {
          session.server.sendResourceListChanged();
        } catch (_e) {
          // Session may be disconnected
        }
      }
    }
  }

  /**
   * Update a widget tool's configuration in place (for HMR)
   *
   * This method updates a widget tool's metadata (description, schema) without
   * re-registering it. It updates both the wrapper's registrations and the SDK's
   * internal state, then sends notifications to all connected clients.
   *
   * @param toolName - The name of the tool to update
   * @param updates - The updated tool configuration
   * @internal
   */
  public updateWidgetToolInPlace(
    toolName: string,
    updates: {
      description?: string;
      schema?: unknown; // Raw Zod schema - will be converted internally
      _meta?: Record<string, unknown>;
    }
  ): boolean {
    // Guard against prototype pollution
    if (!isSafePropertyKey(toolName)) {
      console.warn(
        `[MCP-Server] Rejected potentially malicious tool name: ${toolName}`
      );
      return false;
    }

    // Convert Zod schema to input schema if provided
    let inputSchema: Record<string, unknown> | undefined;
    if ("schema" in updates) {
      try {
        inputSchema = this.convertZodSchemaToParams(updates.schema as any);
      } catch (e) {
        console.warn(
          `[WIDGET-HMR] Failed to convert schema for ${toolName}:`,
          e instanceof Error ? e.message : String(e)
        );
      }
    }

    // Update our wrapper's registration
    const registration = this.registrations.tools.get(toolName);
    if (!registration) {
      // Tool doesn't exist (may have been removed by HMR sync).
      // Return false so caller can fall back to full registration.
      return false;
    }

    if (updates.description !== undefined) {
      registration.config.description = updates.description;
    }
    if (updates._meta !== undefined) {
      // Merge _meta to preserve existing fields like openai/outputTemplate
      registration.config._meta = {
        ...registration.config._meta,
        ...updates._meta,
      };
    }
    if ("schema" in updates) {
      registration.config.schema = updates.schema as any;
    }

    // Update the SDK's internal _registeredTools for all sessions
    for (const [, session] of this.sessions) {
      if (!session.server) continue;
      const nativeServer = session.server as any;
      const toolEntry = nativeServer._registeredTools?.[toolName];
      if (toolEntry) {
        if (updates.description !== undefined) {
          toolEntry.description = updates.description;
        }
        if (updates._meta !== undefined) {
          // Merge _meta to preserve existing fields like openai/outputTemplate
          toolEntry._meta = {
            ...toolEntry._meta,
            ...updates._meta,
          };
        }
        if ("schema" in updates) {
          if (inputSchema !== undefined) {
            toolEntry.inputSchema = inputSchema;
          } else {
            // Explicit schema removal
            delete toolEntry.inputSchema;
          }
        }
      }
    }

    // Send tool list changed notification to all sessions
    for (const [sessionId, session] of this.sessions) {
      if (session.server?.sendToolListChanged) {
        try {
          session.server.sendToolListChanged();
        } catch (e) {
          console.debug(
            `[WIDGET-HMR] Session ${sessionId}: Failed to send tools/list_changed:`,
            e instanceof Error ? e.message : String(e)
          );
        }
      }
    }

    return true;
  }

  /**
   * Remove a widget tool and its associated resources (for HMR)
   *
   * This method removes a widget's tool and resource registrations when
   * the widget is deleted or renamed. It updates both the wrapper's
   * registrations and the SDK's internal state, then sends notifications.
   *
   * @param toolName - The name of the tool/widget to remove
   * @internal
   */
  public removeWidgetTool(toolName: string): void {
    // Guard against prototype pollution
    if (!isSafePropertyKey(toolName)) {
      console.warn(
        `[MCP-Server] Rejected potentially malicious tool name: ${toolName}`
      );
      return;
    }

    // Remove from widget definitions
    this.widgetDefinitions.delete(toolName);

    // Remove from our wrapper's registrations
    // Resources are keyed as "name:uri"
    const resourceUri = generateWidgetUri(toolName, this.buildId, ".html");
    const resourceTemplateUri = generateWidgetUri(
      toolName,
      this.buildId,
      ".html",
      "{id}"
    );
    const resourceKey = `${toolName}:${resourceUri}`;
    // Resource templates are stored by name only (no URI suffix)
    const resourceTemplateKey = `${toolName}-dynamic`;
    this.registrations.tools.delete(toolName);
    this.registrations.resources.delete(resourceKey);
    this.registrations.resourceTemplates.delete(resourceTemplateKey);

    // Remove from the root native server registry as well.
    // Widgets are registered through wrapper methods that also touch native server state;
    // if we only clean per-session state, re-adding the same widget can fail with
    // "Resource ... is already registered".
    const rootNativeServer = this.nativeServer as any;
    if (rootNativeServer._registeredTools?.[toolName]) {
      delete rootNativeServer._registeredTools[toolName];
    }
    if (rootNativeServer._registeredResources?.[resourceUri]) {
      delete rootNativeServer._registeredResources[resourceUri];
    }
    if (rootNativeServer._registeredResources?.[resourceTemplateUri]) {
      delete rootNativeServer._registeredResources[resourceTemplateUri];
    }
    // Some SDK internals also track templates by name; clear both shapes defensively.
    if (rootNativeServer._registeredResourceTemplates?.[resourceTemplateKey]) {
      delete rootNativeServer._registeredResourceTemplates[resourceTemplateKey];
    }
    if (
      rootNativeServer._registeredResourceTemplateNames &&
      typeof rootNativeServer._registeredResourceTemplateNames.delete ===
        "function"
    ) {
      rootNativeServer._registeredResourceTemplateNames.delete(
        resourceTemplateKey
      );
    }

    // Remove from SDK's internal state for all sessions
    for (const [, session] of this.sessions) {
      if (!session.server) continue;
      const nativeServer = session.server as any;

      // Remove tool
      if (nativeServer._registeredTools?.[toolName]) {
        delete nativeServer._registeredTools[toolName];
      }

      // Remove resource (using slugified URI)
      if (nativeServer._registeredResources?.[resourceUri]) {
        delete nativeServer._registeredResources[resourceUri];
      }

      // Remove resource template (using slugified URI)
      if (nativeServer._registeredResources?.[resourceTemplateUri]) {
        delete nativeServer._registeredResources[resourceTemplateUri];
      }
      if (nativeServer._registeredResourceTemplates?.[resourceTemplateKey]) {
        delete nativeServer._registeredResourceTemplates[resourceTemplateKey];
      }
      if (
        nativeServer._registeredResourceTemplateNames &&
        typeof nativeServer._registeredResourceTemplateNames.delete ===
          "function"
      ) {
        nativeServer._registeredResourceTemplateNames.delete(
          resourceTemplateKey
        );
      }
    }

    // Remove from sessionRegisteredRefs (using registration key formats)
    for (const [, refs] of this.sessionRegisteredRefs) {
      refs.tools.delete(toolName);
      refs.resources.delete(resourceKey);
      refs.resourceTemplates.delete(resourceTemplateKey);
    }

    // Send notifications to all sessions
    for (const [sessionId, session] of this.sessions) {
      if (session.server?.sendToolListChanged) {
        try {
          session.server.sendToolListChanged();
        } catch (e) {
          console.debug(
            `[WIDGET-HMR] Session ${sessionId}: Failed to send tools/list_changed:`,
            e instanceof Error ? e.message : String(e)
          );
        }
      }
      if (session.server?.sendResourceListChanged) {
        try {
          session.server.sendResourceListChanged();
        } catch (e) {
          console.debug(
            `[WIDGET-HMR] Session ${sessionId}: Failed to send resources/list_changed:`,
            e instanceof Error ? e.message : String(e)
          );
        }
      }
    }
  }

  /**
   * Sync registrations from another MCPServer instance (for hot reload)
   *
   * This method compares the current registrations with another server instance's
   * registrations and updates existing sessions accordingly:
   * - Removes tools/prompts/resources that no longer exist
   * - Adds new tools/prompts/resources
   * - Updates changed tools/prompts/resources
   *
   * After syncing, sends list_changed notifications to all connected clients.
   *
   * @param other - Another MCPServer instance with updated registrations
   *
   * @example
   * ```typescript
   * // In CLI dev mode, after re-importing the server module
   * const newServer = await import('./server.ts?t=' + Date.now());
   * runningServer.syncRegistrationsFrom(newServer.server);
   * ```
   */
  public syncRegistrationsFrom(other: MCPServerClass<boolean>): {
    totalChanges: number;
    tools: { added: number; removed: number; updated: number };
    prompts: { added: number; removed: number; updated: number };
    resources: { added: number; removed: number; updated: number };
  } {
    // Build session contexts array (shared across all primitives)
    const sessionContexts = Array.from(this.sessions.entries()).map(
      ([sessionId, session]) => ({
        sessionId,
        session,
        refs: this.sessionRegisteredRefs.get(sessionId),
      })
    );

    // Helper to wrap a raw user callback with session context, enhanced context,
    // and AsyncLocalStorage - mirroring what toolRegistration() does at initial registration.
    // Without this wrapping, HMR-updated tools would lose access to context features
    // like ctx.log(), ctx.sample(), ctx.elicit(), etc.
    const wrapHandler = (
      rawHandler: unknown,
      session: { server?: any }
    ): ((
      params: Record<string, unknown>,
      extra?: {
        _meta?: { progressToken?: number };
        sendNotification?: (notification: {
          method: string;
          params: Record<string, unknown>;
        }) => Promise<void>;
      }
    ) => Promise<any>) => {
      // Capture references needed by the closure (avoids aliasing `this`)
      const sessions = this.sessions;
      const createMessageFn = this.createMessage.bind(this);
      const actualCallback = rawHandler as any;

      return async (
        params: Record<string, unknown>,
        extra?: {
          _meta?: { progressToken?: number };
          sendNotification?: (notification: {
            method: string;
            params: Record<string, unknown>;
          }) => Promise<void>;
        }
      ) => {
        const initialRequestContext = getRequestContext();
        const extraProgressToken = extra?._meta?.progressToken;
        const extraSendNotification = extra?.sendNotification;

        const {
          requestContext,
          session: foundSession,
          progressToken,
          sendNotification,
        } = findSessionContext(
          sessions,
          initialRequestContext,
          extraProgressToken,
          extraSendNotification
        );

        const nativeServer = session.server;
        const enhancedContext = createEnhancedContext(
          requestContext,
          createMessageFn,
          nativeServer?.server?.elicitInput?.bind(nativeServer.server) ??
            (async () => ({ action: "decline" as const })),
          progressToken,
          sendNotification,
          foundSession?.logLevel,
          foundSession?.clientCapabilities
        );

        const executeCallback = async () => {
          if (actualCallback.length >= 2) {
            return await actualCallback(params, enhancedContext);
          }
          return await actualCallback(params);
        };

        if (requestContext) {
          return await runWithContext(requestContext, executeCallback);
        }
        return await executeCallback();
      };
    };

    // Helper to create tool entry for SDK
    const createToolEntry = (
      name: string,
      config: ToolDefinition,
      handler: unknown,
      nativeServer: any,
      session?: { server?: any }
    ): RegisteredTool => {
      // For HMR, we need to preserve Zod schemas properly
      // Use the original schema directly, or create z.object({}) for empty schemas
      let inputSchema: z.ZodObject<any> | Record<string, z.ZodSchema>;
      if (config.schema) {
        // Pass the Zod schema directly - it will be used for validation
        inputSchema = config.schema;
      } else if (config.inputs && config.inputs.length > 0) {
        inputSchema = this.createParamsSchema(config.inputs);
      } else {
        // Create proper Zod schema instead of plain {} to ensure safeParseAsync works
        inputSchema = z.object({});
      }

      // Wrap the raw handler with session context so that ctx.log(), ctx.sample(),
      // ctx.elicit(), etc. work correctly after HMR updates
      const wrappedHandler = session?.server
        ? wrapHandler(handler, session)
        : handler;

      return {
        title: config.title,
        description: config.description ?? "",
        inputSchema,
        outputSchema: undefined,
        annotations: config.annotations,
        execution: { taskSupport: "forbidden" },
        _meta: config._meta,
        handler: wrappedHandler,
        enabled: true,
        disable: function (this: RegisteredTool) {
          this.enabled = false;
        },
        enable: function (this: RegisteredTool) {
          this.enabled = true;
        },
        remove: () => {
          // Guard against prototype pollution
          if (!isSafePropertyKey(name)) {
            console.warn(
              `[MCP-Server] Rejected potentially malicious tool name in remove: ${name}`
            );
            return;
          }
          delete nativeServer._registeredTools[name];
        },
        update: function (
          this: RegisteredTool,
          updates: Record<string, unknown>
        ) {
          Object.assign(this, updates);
        },
      } as RegisteredTool;
    };

    // --- TOOLS ---
    const toolsResult = syncPrimitive({
      primitiveName: "Tools",
      currentRegistrations: this.registrations.tools,
      newRegistrations: other.registrations.tools,
      // Don't remove widget-registered tools during index.ts HMR sync.
      // Widget tools are managed by the Vite file watcher, not by index.ts.
      shouldRemove: (_key, reg) => {
        const meta = (reg.config as any)?._meta;
        return !meta?.["mcp-use/widget"];
      },
      sessions: sessionContexts.map(({ sessionId, session, refs }) => ({
        sessionId,
        getRefs: () => refs?.tools,
        register: (name, config, handler) => {
          if (!session.server) return null;
          // Guard against prototype pollution
          if (!isSafePropertyKey(name)) {
            console.warn(
              `[MCP-Server] Rejected potentially malicious tool name: ${name}`
            );
            return null;
          }
          const nativeServer = session.server as any;
          const toolEntry = createToolEntry(
            name,
            config as ToolDefinition,
            handler,
            nativeServer
          );
          nativeServer._registeredTools[name] = toolEntry;
          // Ensure tools/list and tools/call handlers are registered on the SDK server.
          // This is idempotent -- only registers handlers the first time (when
          // _toolHandlersInitialized is false), which happens when the session was
          // created with zero tools (e.g. blank template).
          if (typeof nativeServer.setToolRequestHandlers === "function") {
            nativeServer.setToolRequestHandlers();
          }
          return toolEntry;
        },
      })),
      supportsInPlaceUpdate: true,
      // Order-preserving rename for tools
      onRename: (sessionCtx, oldKey, newKey, config, handler) => {
        const { session, refs } = sessionContexts.find(
          (s) => s.sessionId === sessionCtx.sessionId
        )!;
        if (!session.server) return;
        // Guard against prototype pollution
        if (!isSafePropertyKey(oldKey) || !isSafePropertyKey(newKey)) {
          console.warn(
            `[MCP-Server] Rejected potentially malicious tool name in rename: ${oldKey} -> ${newKey}`
          );
          return;
        }
        const nativeServer = session.server as any;

        // Rebuild _registeredTools object with new name in same position
        const oldTools = nativeServer._registeredTools;
        const newTools: Record<string, any> = {};
        for (const key of Object.keys(oldTools)) {
          if (key === oldKey) {
            newTools[newKey] = createToolEntry(
              newKey,
              config as ToolDefinition,
              handler,
              nativeServer
            );
          } else {
            newTools[key] = oldTools[key];
          }
        }
        nativeServer._registeredTools = newTools;

        // Update refs map preserving order
        if (refs?.tools) {
          const newRefs = new Map<string, RegisteredTool>();
          for (const [k, v] of refs.tools) {
            if (k === oldKey) {
              newRefs.set(newKey, newTools[newKey]);
            } else {
              newRefs.set(k, v);
            }
          }
          refs.tools.clear();
          for (const [k, v] of newRefs) refs.tools.set(k, v);
        }
      },
      // Order-preserving update for tools (schema/description changes)
      onUpdate: (sessionCtx, key, config, handler) => {
        const { session, refs } = sessionContexts.find(
          (s) => s.sessionId === sessionCtx.sessionId
        )!;
        if (!session.server) return;
        // Guard against prototype pollution
        if (!isSafePropertyKey(key)) {
          console.warn(
            `[MCP-Server] Rejected potentially malicious tool name: ${key}`
          );
          return;
        }
        const nativeServer = session.server as any;

        // Update in place to preserve order
        if (nativeServer._registeredTools?.[key]) {
          const newEntry = createToolEntry(
            key,
            config as ToolDefinition,
            handler,
            nativeServer,
            session
          );
          nativeServer._registeredTools[key] = newEntry;
          if (refs?.tools) {
            refs.tools.set(key, newEntry);
          }
        }
      },
    });
    this.registrations.tools = toolsResult.updatedRegistrations;

    // Helper to register prompt on session
    const registerPromptOnSession = (
      server: OfficialMcpServer,
      name: string,
      config: PromptDefinition,
      handler: unknown
    ): RegisteredPrompt => {
      let argsSchema: Record<string, any> | undefined;
      if (config.schema) {
        argsSchema = this.convertZodSchemaToParams(config.schema);
      } else if (config.args && config.args.length > 0) {
        argsSchema = this.createParamsSchema(config.args);
      }
      // Wrap handler to support both CallToolResult and GetPromptResult (same as listen() method)
      const wrappedHandler = async (...args: any[]) => {
        const result = await (handler as any)(...args);

        // If it's already a GetPromptResult, return as-is
        if ("messages" in result && Array.isArray(result.messages)) {
          return result;
        }

        // Convert CallToolResult to GetPromptResult
        const { convertToolResultToPromptResult } =
          await import("./prompts/conversion.js");
        return convertToolResultToPromptResult(result);
      };
      return server.registerPrompt(
        name,
        {
          title: config.title,
          description: config.description ?? "",
          argsSchema: argsSchema as any,
        },
        wrappedHandler as any
      );
    };

    // --- PROMPTS ---
    const promptsResult = syncPrimitive({
      primitiveName: "Prompts",
      currentRegistrations: this.registrations.prompts,
      newRegistrations: other.registrations.prompts,
      sessions: sessionContexts.map(({ sessionId, session, refs }) => ({
        sessionId,
        getRefs: () => refs?.prompts,
        register: (name, config, handler) => {
          if (!session.server) return null;
          // Guard against prototype pollution
          if (!isSafePropertyKey(name)) {
            console.warn(
              `[MCP-Server] Rejected potentially malicious prompt name: ${name}`
            );
            return null;
          }
          return registerPromptOnSession(
            session.server,
            name,
            config as PromptDefinition,
            handler
          );
        },
      })),
      supportsInPlaceUpdate: true,
      // Order-preserving rename for prompts
      onRename: (sessionCtx, oldKey, newKey, config, handler) => {
        const { session, refs } = sessionContexts.find(
          (s) => s.sessionId === sessionCtx.sessionId
        )!;
        if (!session.server) return;
        // Guard against prototype pollution
        if (!isSafePropertyKey(oldKey) || !isSafePropertyKey(newKey)) {
          console.warn(
            `[MCP-Server] Rejected potentially malicious prompt name in rename: ${oldKey} -> ${newKey}`
          );
          return;
        }
        const nativeServer = session.server as any;

        // Rebuild _registeredPrompts object with new name in same position
        const oldPrompts = nativeServer._registeredPrompts || {};
        const newPrompts: Record<string, any> = {};
        for (const key of Object.keys(oldPrompts)) {
          if (key === oldKey) {
            // Register new prompt to get proper entry, then move to correct position
            const registered = registerPromptOnSession(
              session.server,
              newKey,
              config as PromptDefinition,
              handler
            );
            delete nativeServer._registeredPrompts[newKey]; // Remove from end
            newPrompts[newKey] = registered;
          } else {
            newPrompts[key] = oldPrompts[key];
          }
        }
        nativeServer._registeredPrompts = newPrompts;

        // Update refs map preserving order
        if (refs?.prompts) {
          const newRefs = new Map<string, RegisteredPrompt>();
          for (const [k, v] of refs.prompts) {
            if (k === oldKey) {
              newRefs.set(newKey, newPrompts[newKey]);
            } else {
              newRefs.set(k, v);
            }
          }
          refs.prompts.clear();
          for (const [k, v] of newRefs) refs.prompts.set(k, v);
        }
      },
      // Order-preserving update for prompts - use SDK's update method
      onUpdate: (sessionCtx, key, config, handler) => {
        // Guard against prototype pollution
        if (!isSafePropertyKey(key)) {
          console.warn(
            `[MCP-Server] Rejected potentially malicious prompt name: ${key}`
          );
          return;
        }
        const { refs } = sessionContexts.find(
          (s) => s.sessionId === sessionCtx.sessionId
        )!;
        const promptRef = refs?.prompts.get(key);
        if (promptRef) {
          const newReg = config as PromptDefinition;
          let argsSchema: Record<string, any> | undefined;
          if (newReg.schema) {
            argsSchema = this.convertZodSchemaToParams(newReg.schema);
          } else if (newReg.args && newReg.args.length > 0) {
            argsSchema = this.createParamsSchema(newReg.args);
          }

          // Wrap handler to support both CallToolResult and GetPromptResult
          // This ensures prompts can use tool response helpers (text(), object(), etc.)
          const wrappedHandler = async (
            params: Record<string, unknown>,
            extra?: any
          ) => {
            const result = await (handler as any)(params, extra);

            // If it's already a GetPromptResult, return as-is
            if ("messages" in result && Array.isArray(result.messages)) {
              return result as any;
            }

            // Convert CallToolResult to GetPromptResult
            const { convertToolResultToPromptResult } =
              await import("./prompts/conversion.js");
            return convertToolResultToPromptResult(result) as any;
          };

          promptRef.update({
            title: newReg.title,
            description: newReg.description,
            argsSchema: argsSchema as any,
            callback: wrappedHandler as any,
          });
        }
      },
    });
    this.registrations.prompts = promptsResult.updatedRegistrations;

    // Helper to register resource on session
    const registerResourceOnSession = (
      server: OfficialMcpServer,
      name: string,
      config: ResourceDefinition,
      handler: unknown
    ): RegisteredResource => {
      // Wrap handler to support both CallToolResult and ReadResourceResult
      const wrappedHandler = async (extra?: any) => {
        const result = await (handler as any)(extra);

        // If it's already a ReadResourceResult, return as-is
        if ("contents" in result && Array.isArray(result.contents)) {
          return result;
        }

        // Convert CallToolResult to ReadResourceResult
        const { convertToolResultToResourceResult } =
          await import("./resources/conversion.js");
        return convertToolResultToResourceResult(config.uri, result);
      };

      return server.registerResource(
        config.name || name,
        config.uri,
        {
          title: config.title,
          description: config.description,
          mimeType: config.mimeType || "text/plain",
        },
        wrappedHandler as any
      );
    };

    // --- RESOURCES ---
    // IMPORTANT: Preserve widget resources during HMR
    // Widget resources (ui://widget/*) are only registered on initial load, not during HMR
    // Copy them to the new server's registrations to prevent deletion
    for (const [key, registration] of this.registrations.resources) {
      const uri = (registration.config as any).uri;
      if (uri && uri.startsWith("ui://widget/")) {
        other.registrations.resources.set(key, registration);
      }
    }
    // ALSO preserve widget resource templates (for dynamic URIs)
    for (const [key, registration] of this.registrations.resourceTemplates) {
      const uriTemplate = (registration.config as any).resourceTemplate
        ?.uriTemplate;
      if (uriTemplate && uriTemplate.startsWith("ui://widget/")) {
        other.registrations.resourceTemplates.set(key, registration);
      }
    }

    const resourcesResult = syncPrimitive({
      primitiveName: "Resources",
      currentRegistrations: this.registrations.resources,
      newRegistrations: other.registrations.resources,
      sessions: sessionContexts.map(({ sessionId, session, refs }) => ({
        sessionId,
        getRefs: () => refs?.resources,
        register: (name, config, handler) => {
          if (!session.server) return null;
          // Guard against prototype pollution
          if (!isSafePropertyKey(name)) {
            console.warn(
              `[MCP-Server] Rejected potentially malicious resource name: ${name}`
            );
            return null;
          }
          return registerResourceOnSession(
            session.server,
            name,
            config as ResourceDefinition,
            handler
          );
        },
      })),
      supportsInPlaceUpdate: true,
      // Order-preserving rename for resources
      onRename: (sessionCtx, oldKey, newKey, config, handler) => {
        const { session, refs } = sessionContexts.find(
          (s) => s.sessionId === sessionCtx.sessionId
        )!;
        if (!session.server) return;
        // Guard against prototype pollution
        if (!isSafePropertyKey(oldKey) || !isSafePropertyKey(newKey)) {
          console.warn(
            `[MCP-Server] Rejected potentially malicious resource name in rename: ${oldKey} -> ${newKey}`
          );
          return;
        }
        const nativeServer = session.server as any;

        // Rebuild _registeredResources object with new key in same position
        const oldResources = nativeServer._registeredResources || {};
        const newResources: Record<string, any> = {};
        for (const key of Object.keys(oldResources)) {
          if (key === oldKey) {
            const registered = registerResourceOnSession(
              session.server,
              newKey,
              config as ResourceDefinition,
              handler
            );
            delete nativeServer._registeredResources[newKey]; // Remove from end
            newResources[newKey] = registered;
          } else {
            newResources[key] = oldResources[key];
          }
        }
        nativeServer._registeredResources = newResources;

        // Update refs map preserving order
        if (refs?.resources) {
          const newRefs = new Map<string, RegisteredResource>();
          for (const [k, v] of refs.resources) {
            if (k === oldKey) {
              newRefs.set(newKey, newResources[newKey]);
            } else {
              newRefs.set(k, v);
            }
          }
          refs.resources.clear();
          for (const [k, v] of newRefs) refs.resources.set(k, v);
        }
      },
      // Order-preserving update for resources - use SDK's update method
      onUpdate: (sessionCtx, key, config, handler) => {
        // Guard against prototype pollution
        if (!isSafePropertyKey(key)) {
          console.warn(
            `[MCP-Server] Rejected potentially malicious resource name: ${key}`
          );
          return;
        }
        const { refs } = sessionContexts.find(
          (s) => s.sessionId === sessionCtx.sessionId
        )!;
        const resourceRef = refs?.resources.get(key);
        if (resourceRef) {
          const newReg = config as ResourceDefinition;

          // Wrap handler to support both CallToolResult and ReadResourceResult
          // This ensures resources can use tool response helpers (text(), object(), etc.)
          const wrappedHandler = async (extra?: any) => {
            const result = await (handler as any)(extra);

            // If it's already a ReadResourceResult, return as-is
            if ("contents" in result && Array.isArray(result.contents)) {
              return result;
            }

            // Convert CallToolResult to ReadResourceResult
            const { convertToolResultToResourceResult } =
              await import("./resources/conversion.js");
            return convertToolResultToResourceResult(newReg.uri, result);
          };

          resourceRef.update({
            metadata: {
              title: newReg.title,
              description: newReg.description,
              mimeType: newReg.mimeType || "text/plain",
            },
            callback: wrappedHandler as any,
          });
        }
      },
    });
    this.registrations.resources = resourcesResult.updatedRegistrations;

    // Helper to register resource template on session
    const registerTemplateOnSession = (
      server: OfficialMcpServer,
      name: string,
      config: ResourceTemplateDefinition,
      handler: unknown
    ): RegisteredResourceTemplate => {
      const isFlatStructure = "uriTemplate" in config;
      const uriTemplate = isFlatStructure
        ? (config as any).uriTemplate
        : config.resourceTemplate.uriTemplate;
      const mimeType = isFlatStructure
        ? (config as any).mimeType
        : config.resourceTemplate.mimeType;
      const templateDescription = isFlatStructure
        ? undefined
        : config.resourceTemplate.description;
      const resourceCallbacks: ResourceTemplateCallbacks | undefined =
        isFlatStructure
          ? (config as any).callbacks
          : config.resourceTemplate.callbacks;

      const template = new ResourceTemplate(uriTemplate, {
        list: undefined,
        complete: toResourceTemplateCompleteCallbacks(
          resourceCallbacks?.complete
        ),
      });
      const metadata: Record<string, unknown> = {};
      if (config.title) metadata.title = config.title;
      if (config.description || templateDescription)
        metadata.description = config.description || templateDescription;
      if (mimeType) metadata.mimeType = mimeType;
      if (config.annotations) metadata.annotations = config.annotations;

      // Wrap handler to support both CallToolResult and ReadResourceResult
      const wrappedHandler = async (uri: URL, extra?: any) => {
        const result = await (handler as any)(uri, extra);

        // If it's already a ReadResourceResult, return as-is
        if ("contents" in result && Array.isArray(result.contents)) {
          return result;
        }

        // Convert CallToolResult to ReadResourceResult
        const { convertToolResultToResourceResult } =
          await import("./resources/conversion.js");
        return convertToolResultToResourceResult(uri.toString(), result);
      };

      return server.registerResource(
        name,
        template,
        metadata as any,
        wrappedHandler as any
      ) as unknown as RegisteredResourceTemplate;
    };

    // --- RESOURCE TEMPLATES ---
    const templatesResult = syncPrimitive({
      primitiveName: "Resource Templates",
      currentRegistrations: this.registrations.resourceTemplates,
      newRegistrations: other.registrations.resourceTemplates,
      sessions: sessionContexts.map(({ sessionId, session, refs }) => ({
        sessionId,
        getRefs: () => refs?.resourceTemplates as Map<string, any> | undefined,
        register: (name, config, handler) => {
          if (!session.server) return null;
          // Guard against prototype pollution
          if (!isSafePropertyKey(name)) {
            console.warn(
              `[MCP-Server] Rejected potentially malicious resource template name: ${name}`
            );
            return null;
          }
          return registerTemplateOnSession(
            session.server,
            name,
            config as ResourceTemplateDefinition,
            handler
          );
        },
      })),
      supportsInPlaceUpdate: false, // Templates require full re-registration
      // Order-preserving rename for resource templates
      onRename: (sessionCtx, oldKey, newKey, config, handler) => {
        const { session, refs } = sessionContexts.find(
          (s) => s.sessionId === sessionCtx.sessionId
        )!;
        if (!session.server) return;
        // Guard against prototype pollution
        if (!isSafePropertyKey(oldKey) || !isSafePropertyKey(newKey)) {
          console.warn(
            `[MCP-Server] Rejected potentially malicious resource template name in rename: ${oldKey} -> ${newKey}`
          );
          return;
        }
        const nativeServer = session.server as any;

        // Resource templates are stored in _registeredResources with URI as key
        const oldResources = nativeServer._registeredResources || {};
        const newResources: Record<string, any> = {};
        for (const key of Object.keys(oldResources)) {
          if (key === oldKey) {
            const registered = registerTemplateOnSession(
              session.server,
              newKey,
              config as ResourceTemplateDefinition,
              handler
            );
            delete nativeServer._registeredResources[newKey]; // Remove from end
            newResources[newKey] = registered;
          } else {
            newResources[key] = oldResources[key];
          }
        }
        nativeServer._registeredResources = newResources;

        // Update refs map preserving order
        if (refs?.resourceTemplates) {
          const newRefs = new Map<string, RegisteredResourceTemplate>();
          for (const [k, v] of refs.resourceTemplates) {
            if (k === oldKey) {
              newRefs.set(newKey, newResources[newKey]);
            } else {
              newRefs.set(k, v);
            }
          }
          refs.resourceTemplates.clear();
          for (const [k, v] of newRefs) refs.resourceTemplates.set(k, v);
        }
      },
      // Order-preserving update for resource templates - need full re-registration
      // since templates are complex, but we rebuild the object to preserve order
      onUpdate: (sessionCtx, key, config, handler) => {
        // Guard against prototype pollution
        if (!isSafePropertyKey(key)) {
          console.warn(
            `[MCP-Server] Rejected potentially malicious resource template name: ${key}`
          );
          return;
        }
        const { session, refs } = sessionContexts.find(
          (s) => s.sessionId === sessionCtx.sessionId
        )!;
        if (!session.server) return;
        const nativeServer = session.server as any;

        // Get original keys order
        const originalKeys = Object.keys(
          nativeServer._registeredResources || {}
        );

        // Remove old and register new
        const oldRef = refs?.resourceTemplates.get(key);
        if (oldRef) oldRef.remove();

        const registered = registerTemplateOnSession(
          session.server,
          key,
          config as ResourceTemplateDefinition,
          handler
        );

        // Rebuild to preserve original order
        const current = nativeServer._registeredResources || {};
        const newResources: Record<string, any> = {};
        for (const k of originalKeys) {
          if (current[k]) {
            newResources[k] = current[k];
          }
        }
        // Add any new keys that weren't in original
        for (const k of Object.keys(current)) {
          if (!newResources[k]) {
            newResources[k] = current[k];
          }
        }
        nativeServer._registeredResources = newResources;

        if (refs?.resourceTemplates && registered) {
          refs.resourceTemplates.set(key, registered);
        }
      },
    });
    this.registrations.resourceTemplates = templatesResult.updatedRegistrations;

    // Sync widget definitions (for widget() helper metadata)
    // IMPORTANT: During HMR, widget resources aren't re-registered, so the new server's
    // widgetDefinitions Map is empty. We need to:
    // 1. Update definitions on THIS (running) server
    // 2. ALSO copy them to OTHER (new) server so closures in handlers can find them
    for (const [widgetName, widgetDef] of other.widgetDefinitions) {
      this.widgetDefinitions.set(widgetName, widgetDef);
    }
    // Copy existing widget definitions TO the new server as well
    // This ensures tool callback wrappers (which reference the new server via closure) can find them
    for (const [widgetName, widgetDef] of this.widgetDefinitions) {
      if (!other.widgetDefinitions.has(widgetName)) {
        other.widgetDefinitions.set(widgetName, widgetDef);
      }
    }

    // Update tracking arrays
    this.registeredTools = Array.from(this.registrations.tools.keys());
    this.registeredPrompts = Array.from(this.registrations.prompts.keys());
    this.registeredResources = Array.from(this.registrations.resources.keys());

    // --- CUSTOM HTTP ROUTES ---
    // Sync custom HTTP route handlers (registered via server.get(), server.post(), etc.)
    // The middleware installed at startup reads from _customRoutes at request time,
    // so we only need to update the map — no Hono router changes needed.
    // See: https://github.com/honojs/hono/issues/3817
    if (other._customRoutes.size > 0) {
      for (const [key, handlers] of other._customRoutes) {
        this._customRoutes.set(key, handlers);
      }
    }
    // Remove routes that no longer exist in the new module
    for (const key of this._customRoutes.keys()) {
      if (!other._customRoutes.has(key)) {
        this._customRoutes.delete(key);
      }
    }

    // Log all changes
    const allChanges = [
      toolsResult.changes,
      promptsResult.changes,
      resourcesResult.changes,
      templatesResult.changes,
    ];
    const totalChanges = countChanges(...allChanges);

    if (totalChanges > 0) {
      console.log("[HMR] Registration changes:");
      logChanges("Tools", toolsResult.changes);
      logChanges("Prompts", promptsResult.changes);
      logChanges("Resources", resourcesResult.changes);
      logChanges("Resource Templates", templatesResult.changes);

      // Send list_changed notifications to all sessions
      for (const [sessionId, session] of this.sessions) {
        if (session.server) {
          try {
            if (
              toolsResult.changes.added.length ||
              toolsResult.changes.removed.length ||
              toolsResult.changes.updated.length
            ) {
              session.server.sendToolListChanged();
            }
          } catch (e) {
            console.debug(
              `[HMR] Session ${sessionId}: Failed to send tools/list_changed:`,
              e instanceof Error ? e.message : String(e)
            );
          }
          try {
            if (
              promptsResult.changes.added.length ||
              promptsResult.changes.removed.length ||
              promptsResult.changes.updated.length
            ) {
              session.server.sendPromptListChanged();
            }
          } catch (e) {
            console.debug(
              `[HMR] Session ${sessionId}: Failed to send prompts/list_changed:`,
              e instanceof Error ? e.message : String(e)
            );
          }
          try {
            if (
              resourcesResult.changes.added.length ||
              resourcesResult.changes.removed.length ||
              resourcesResult.changes.updated.length ||
              templatesResult.changes.added.length ||
              templatesResult.changes.removed.length ||
              templatesResult.changes.updated.length
            ) {
              session.server.sendResourceListChanged();
            }
          } catch (e) {
            console.debug(
              `[HMR] Session ${sessionId}: Failed to send resources/list_changed:`,
              e instanceof Error ? e.message : String(e)
            );
          }
        }
      }
    } else {
      console.log("[HMR] No registration changes detected");
    }

    return {
      totalChanges,
      tools: {
        added: toolsResult.changes.added.length,
        removed: toolsResult.changes.removed.length,
        updated: toolsResult.changes.updated.length,
      },
      prompts: {
        added: promptsResult.changes.added.length,
        removed: promptsResult.changes.removed.length,
        updated: promptsResult.changes.updated.length,
      },
      resources: {
        added:
          resourcesResult.changes.added.length +
          templatesResult.changes.added.length,
        removed:
          resourcesResult.changes.removed.length +
          templatesResult.changes.removed.length,
        updated:
          resourcesResult.changes.updated.length +
          templatesResult.changes.updated.length,
      },
    };
  }

  /**
   * Get the most recently created MCPServer instance.
   * Used by CLI dev mode for hot reload support.
   * Uses globalThis to work across ESM module boundaries.
   * @internal
   */
  public static getLastCreatedInstance(): MCPServerClass<any> | null {
    return (globalThis as any).__mcpUseLastServer || null;
  }

  /**
   * Creates a new MCP server instance with Hono integration.
   *
   * Initializes the server with the provided configuration, sets up the native MCP
   * server from the official SDK, creates a Hono application for HTTP handling,
   * and configures the environment for serving MCP protocol over HTTP.
   *
   * The constructor automatically:
   * - Creates the native MCP server with protocol capabilities
   * - Initializes the Hono web framework
   * - Sets up OAuth if configured
   * - Configures session management (stateful or stateless)
   * - Wraps registration methods for multi-session support
   * - Returns a proxy that supports both MCP and Hono methods
   *
   * @param config - Server configuration object
   * @param config.name - Server name (displayed to clients)
   * @param config.version - Server version string (default: "1.0.0")
   * @param config.description - Optional server description
   * @param config.host - Hostname for URLs (default: "localhost")
   * @param config.baseUrl - Full base URL (overrides host:port for public URLs)
   * @param config.favicon - Optional favicon URL
   * @param config.oauth - Optional OAuth provider configuration
   * @param config.stateless - Whether to use stateless mode (auto-detected for Deno)
   * @param config.sessionIdleTimeoutMs - Session idle timeout (default: 86400000 = 1 day)
   * @param config.allowedOrigins - Allowed CORS origins (see {@link ServerConfig.allowedOrigins})
   *
   * @returns Proxied server instance supporting both MCP and Hono methods
   *
   * @example
   * ```typescript
   * // Minimal configuration
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0'
   * });
   * ```
   *
   * @example
   * ```typescript
   * // With custom host and description
   * const server = new MCPServer({
   *   name: 'api-server',
   *   version: '2.0.0',
   *   description: 'API integration server',
   *   host: '0.0.0.0', // Listen on all interfaces
   *   baseUrl: 'https://api.example.com' // Public URL
   * });
   * ```
   *
   * @example
   * ```typescript
   * // With OAuth authentication
   * const server = new MCPServer({
   *   name: 'secure-server',
   *   version: '1.0.0',
   *   oauth: oauthWorkOSProvider({
   *     clientId: process.env.WORKOS_CLIENT_ID!,
   *     clientSecret: process.env.WORKOS_CLIENT_SECRET!,
   *     apiKey: process.env.WORKOS_API_KEY!
   *   })
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Stateless mode (for serverless platforms)
   * const server = new MCPServer({
   *   name: 'edge-server',
   *   version: '1.0.0',
   *   stateless: true // No session storage
   * });
   * ```
   *
   * @see {@link ServerConfig} for detailed configuration options
   * @see {@link listen} for starting the HTTP server
   * @see {@link getHandler} for serverless deployment
   */
  constructor(config: ServerConfig) {
    this.config = config;

    // Track this instance for HMR support (CLI dev mode uses this to find the server)
    // Uses globalThis to work across ESM module boundaries with cache-busting imports
    (globalThis as any).__mcpUseLastServer = this;

    // Auto-detect stateless mode: Deno = stateless, Node.js = stateful
    if (this.config.stateless === undefined) {
      this.config.stateless = isDeno;
      if (this.config.stateless) {
        console.log("[MCP] Deno detected - using stateless mode (no sessions)");
      }
    }

    this.serverHost = config.host || "localhost";
    this.serverBaseUrl = config.baseUrl;

    // Auto-select favicon from icons array if not explicitly provided
    if (config.favicon) {
      this.favicon = config.favicon;
    } else if (config.icons && config.icons.length > 0) {
      this.favicon = selectFaviconFromIcons(config.icons);
      console.log(`[MCP] Auto-selected favicon from icons: ${this.favicon}`);
    }

    // Helper to convert relative icon paths to absolute URLs
    const processIconUrls = (
      icons: ServerConfig["icons"],
      baseUrl?: string
    ) => {
      if (!icons || !baseUrl) return icons;
      return icons.map((icon) => ({
        ...icon,
        src: icon.src.startsWith("http")
          ? icon.src
          : `${baseUrl}/mcp-use/public/${icon.src}`,
      }));
    };

    // Create native SDK server instance with capabilities
    this.nativeServer = new OfficialMcpServer(
      {
        name: config.name,
        version: config.version,
        description: config.description,
        title: config.title,
        websiteUrl: config.websiteUrl,
        icons: processIconUrls(config.icons, config.baseUrl),
      },
      {
        capabilities: {
          logging: {},
          completions: {},
          tools: {
            listChanged: true,
          },
          prompts: {
            listChanged: true,
          },
          resources: {
            subscribe: true,
            listChanged: true,
          },
        },
      }
    );

    // Create and configure Hono app with default middleware
    this.app = createHonoApp(requestLogger);

    // Install the custom routes middleware FIRST (before any other routes).
    // This single middleware dispatches from the mutable _customRoutes map,
    // enabling HMR for custom HTTP routes (server.get(), server.post(), etc.)
    // without hitting Hono's "matcher already built" error.
    // See: https://github.com/honojs/hono/issues/3817
    installCustomRoutesMiddleware(this.app, this._customRoutes);

    // Setup public routes immediately if icons/favicon are configured
    // This ensures icons are served even before listen() or getHandler() is called
    // Only set up dev routes if not in production mode - production routes will be set up later
    if (
      (this.favicon || this.config.icons) &&
      !isProductionModeHelper() &&
      !isDeno
    ) {
      setupPublicRoutes(this.app, false); // Dev mode (public/)
      setupFaviconRoute(this.app, this.favicon, false);
      this.publicRoutesMode = "dev";
    }

    this.oauthProvider = config.oauth;

    // Wrap registration methods to capture registrations for multi-session support
    this.wrapRegistrationMethods();

    // Return proxied instance that allows direct access to Hono methods
    return createHonoProxy(this, this.app);
  }

  /**
   * Wrap registration methods to capture registrations following official SDK pattern.
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
      T extends import("./types/index.js").ToolDefinition<any, any, HasOAuth>,
    >(
      toolDefinition: T,
      callback?: import("./types/index.js").ToolCallback<
        import("./types/index.js").InferToolInput<T>,
        import("./types/index.js").InferToolOutput<T>,
        HasOAuth
      >
    ) => {
      // Auto-add widget metadata if widget config is set
      // This matches the metadata structure used by auto-registered widget tools
      const widgetConfig = toolDefinition.widget;
      const widgetName = widgetConfig?.name;

      if (widgetConfig && widgetName) {
        const buildIdPart = self.buildId ? `-${self.buildId}` : "";
        const outputTemplate = `ui://widget/${widgetName}${buildIdPart}.html`;

        // Look up widget type to determine if dual-protocol metadata is needed
        const widgetDef = self.widgetDefinitions.get(widgetName);
        const widgetType = widgetDef?.["mcp-use/widgetType"] as
          | string
          | undefined;

        if (widgetType === "mcpApps") {
          // Generate dual-protocol metadata for mcpApps widgets
          const mcpAppsAdapter = new McpAppsAdapter();
          const appsSdkAdapter = new AppsSdkAdapter();

          // Create a definition for adapter calls with metadata field
          const adapterDef = {
            type: "mcpApps" as const,
            name: widgetName,
            _meta: widgetDef,
            metadata: (widgetDef?.["mcp-use/widget"] as any)?.metadata,
          };

          // Build both tool and resource metadata
          const mcpAppsToolMeta = mcpAppsAdapter.buildToolMetadata(
            adapterDef as any,
            outputTemplate
          );
          const mcpAppsResourceMeta = mcpAppsAdapter.buildResourceMetadata(
            adapterDef as any
          );
          const appsSdkToolMeta = appsSdkAdapter.buildToolMetadata(
            adapterDef as any,
            outputTemplate
          );
          const appsSdkResourceMeta = appsSdkAdapter.buildResourceMetadata(
            adapterDef as any
          );

          // Deep merge the ui metadata
          const mergedUiMeta = {
            ...((mcpAppsToolMeta.ui as Record<string, unknown>) || {}),
            ...(mcpAppsResourceMeta._meta?.ui || {}),
          };

          toolDefinition._meta = {
            ...toolDefinition._meta,
            ...mcpAppsToolMeta,
            ...appsSdkToolMeta,
            ...(appsSdkResourceMeta._meta || {}),
            ui: mergedUiMeta,
            "openai/toolInvocation/invoking":
              widgetConfig.invoking ?? `Loading ${widgetName}...`,
            "openai/toolInvocation/invoked":
              widgetConfig.invoked ?? `${widgetName} ready`,
            "openai/widgetAccessible": widgetConfig.widgetAccessible ?? true,
            "openai/resultCanProduceWidget":
              widgetConfig.resultCanProduceWidget ?? true,
          };
        } else {
          // Legacy Apps SDK only metadata
          toolDefinition._meta = {
            ...toolDefinition._meta,
            "openai/outputTemplate": outputTemplate,
            "openai/toolInvocation/invoking":
              widgetConfig.invoking ?? `Loading ${widgetName}...`,
            "openai/toolInvocation/invoked":
              widgetConfig.invoked ?? `${widgetName} ready`,
            "openai/widgetAccessible": widgetConfig.widgetAccessible ?? true,
            "openai/resultCanProduceWidget":
              widgetConfig.resultCanProduceWidget ?? true,
          };
        }
      }

      let actualCallback = callback || toolDefinition.cb;

      // If widget config is set, wrap the callback to inject widget metadata into response
      if (widgetConfig && widgetName && actualCallback) {
        const originalCallback = actualCallback;
        actualCallback = (async (params: any, ctx: any) => {
          const result = await originalCallback(params, ctx);

          // Look up the widget definition and inject its metadata into the response
          // Use self (the running server) because widgetDefinitions are synced TO the running server during HMR
          const widgetDef = self.widgetDefinitions.get(widgetName);
          const widgetType = widgetDef?.["mcp-use/widgetType"] as
            | string
            | undefined;

          if (result && typeof result === "object") {
            // Generate unique URI for this invocation
            const randomId = Math.random().toString(36).substring(2, 15);
            const buildIdPart = self.buildId ? `-${self.buildId}` : "";
            const uniqueUri = `ui://widget/${widgetName}${buildIdPart}-${randomId}.html`;

            // Build response metadata based on widget type
            let responseMeta: Record<string, unknown>;

            if (widgetType === "mcpApps") {
              // Generate dual-protocol metadata for mcpApps widgets
              const mcpAppsAdapter = new McpAppsAdapter();
              const appsSdkAdapter = new AppsSdkAdapter();

              // Create a definition for adapter calls with metadata field
              const adapterDef = {
                type: "mcpApps" as const,
                name: widgetName,
                _meta: widgetDef,
                metadata: (widgetDef?.["mcp-use/widget"] as any)?.metadata,
              };

              // Build both tool and resource metadata
              const mcpAppsToolMeta = mcpAppsAdapter.buildToolMetadata(
                adapterDef as any,
                uniqueUri
              );
              const mcpAppsResourceMeta = mcpAppsAdapter.buildResourceMetadata(
                adapterDef as any
              );
              const appsSdkToolMeta = appsSdkAdapter.buildToolMetadata(
                adapterDef as any,
                uniqueUri
              );
              const appsSdkResourceMeta = appsSdkAdapter.buildResourceMetadata(
                adapterDef as any
              );

              // Deep merge the ui metadata
              const mergedUiMeta = {
                ...((mcpAppsToolMeta.ui as Record<string, unknown>) || {}),
                ...(mcpAppsResourceMeta._meta?.ui || {}),
              };

              responseMeta = {
                ...(widgetDef || {}), // Include mcp-use/widget and other widget metadata
                ...mcpAppsToolMeta,
                ...appsSdkToolMeta,
                ...(appsSdkResourceMeta._meta || {}),
                ui: mergedUiMeta,
                "openai/toolInvocation/invoking":
                  widgetConfig.invoking ?? `Loading ${widgetName}...`,
                "openai/toolInvocation/invoked":
                  widgetConfig.invoked ?? `${widgetName} ready`,
                "openai/widgetAccessible":
                  widgetConfig.widgetAccessible ?? true,
                "openai/resultCanProduceWidget":
                  widgetConfig.resultCanProduceWidget ?? true,
              };
            } else {
              // Legacy Apps SDK only metadata
              responseMeta = {
                ...(widgetDef || {}), // Include mcp-use/widget and other widget metadata
                "openai/outputTemplate": uniqueUri,
                "openai/toolInvocation/invoking":
                  widgetConfig.invoking ?? `Loading ${widgetName}...`,
                "openai/toolInvocation/invoked":
                  widgetConfig.invoked ?? `${widgetName} ready`,
                "openai/widgetAccessible":
                  widgetConfig.widgetAccessible ?? true,
                "openai/resultCanProduceWidget":
                  widgetConfig.resultCanProduceWidget ?? true,
              };
            }

            // Set _meta on the result, merging with any existing _meta (e.g., from widget() helper)
            (result as any)._meta = {
              ...(result._meta || {}),
              ...responseMeta,
            };

            // Update message if empty
            if (
              (result as any).content?.[0]?.type === "text" &&
              !(result as any).content[0].text
            ) {
              (result as any).content[0].text = `Displaying ${widgetName}`;
            }
          }

          return result;
        }) as typeof actualCallback;
      }

      if (actualCallback) {
        self.registrations.tools.set(toolDefinition.name, {
          config: toolDefinition as any,
          handler: actualCallback as any,
        });
      }
      return originalTool.call(self, toolDefinition, actualCallback as any);
    }) as any;

    this.prompt = ((
      promptDefinition:
        | import("./types/index.js").PromptDefinition<any, HasOAuth>
        | import("./types/index.js").PromptDefinitionWithoutCallback,
      callback?: import("./types/index.js").PromptCallback<any, HasOAuth>
    ) => {
      // First call originalPrompt which creates the wrapped handler with conversion logic
      const result = originalPrompt.call(
        self as any,
        promptDefinition,
        callback as any
      );

      // After originalPrompt returns, the registeredPrompts list is updated
      // Store the prompt info in registrations for HMR (the handler is already wrapped by originalPrompt)
      const actualCallback = callback || (promptDefinition as any).cb;
      if (actualCallback && !(self as any).isReplaying) {
        // Store the raw callback - the wrapping will happen again during sync via originalPrompt
        self.registrations.prompts.set(promptDefinition.name, {
          config: promptDefinition as any,
          handler: actualCallback as any,
        });
      }
      return result;
    }) as any;

    this.resource = ((
      resourceDefinition:
        | import("./types/index.js").ResourceDefinition<HasOAuth>
        | import("./types/index.js").ResourceDefinitionWithoutCallback,
      callback?: import("./types/index.js").ReadResourceCallback<HasOAuth>
    ) => {
      const actualCallback =
        callback || (resourceDefinition as any).readCallback;
      if (actualCallback) {
        const resourceKey = `${resourceDefinition.name}:${resourceDefinition.uri}`;
        self.registrations.resources.set(resourceKey, {
          config: resourceDefinition as any,
          handler: actualCallback as any,
        });
      }
      return originalResource.call(self, resourceDefinition, callback as any);
    }) as any;

    this.resourceTemplate = ((
      templateDefinition:
        | import("./types/index.js").ResourceTemplateDefinition<HasOAuth>
        | import("./types/index.js").ResourceTemplateDefinitionWithoutCallback
        | import("./types/index.js").FlatResourceTemplateDefinition<HasOAuth>
        | import("./types/index.js").FlatResourceTemplateDefinitionWithoutCallback,
      callback?: import("./types/index.js").ReadResourceTemplateCallback<HasOAuth>
    ) => {
      const actualCallback =
        callback || (templateDefinition as any).readCallback;
      if (actualCallback) {
        self.registrations.resourceTemplates.set(templateDefinition.name, {
          config: templateDefinition as any,
          handler: actualCallback as any,
        });
      }
      return originalResourceTemplate.call(
        self,
        templateDefinition,
        callback as any
      );
    }) as any;
  }

  /**
   * Create a new server instance for a session following official SDK pattern.
   * This is called for each initialize request to create an isolated server.
   *
   * @param sessionId - Optional session ID to store registered refs for hot reload support
   */
  public getServerForSession(sessionId?: string): OfficialMcpServer {
    // Helper to convert relative icon paths to absolute URLs
    const processIconUrls = (
      icons: ServerConfig["icons"],
      baseUrl?: string
    ) => {
      if (!icons || !baseUrl) return icons;
      return icons.map((icon) => ({
        ...icon,
        src: icon.src.startsWith("http")
          ? icon.src
          : `${baseUrl}/mcp-use/public/${icon.src}`,
      }));
    };

    const newServer = new OfficialMcpServer(
      {
        name: this.config.name,
        version: this.config.version,
        description: this.config.description,
        title: this.config.title,
        websiteUrl: this.config.websiteUrl,
        icons: processIconUrls(this.config.icons, this.serverBaseUrl),
      },
      {
        capabilities: {
          logging: {},
          completions: {},
          tools: {
            listChanged: true,
          },
          prompts: {
            listChanged: true,
          },
          resources: {
            subscribe: true,
            listChanged: true,
          },
        },
      }
    );

    // Pre-initialize all request handlers (tools/list, prompts/list, resources/list)
    // on the SDK server so they are always available, even when starting with zero
    // registrations (e.g. blank template). Without this, HMR-added tools would
    // trigger list_changed notifications but the tools/list handler wouldn't exist,
    // causing -32601 "Method not found" errors on clients.
    // These calls are idempotent -- they check internal *HandlersInitialized flags.
    const serverAny = newServer as any;
    if (typeof serverAny.setToolRequestHandlers === "function") {
      serverAny.setToolRequestHandlers();
    }
    if (typeof serverAny.setPromptRequestHandlers === "function") {
      serverAny.setPromptRequestHandlers();
    }
    if (typeof serverAny.setResourceRequestHandlers === "function") {
      serverAny.setResourceRequestHandlers();
    }

    // Initialize refs storage for this session (for hot reload support)
    const sessionRefs = {
      tools: new Map<string, RegisteredTool>(),
      prompts: new Map<string, RegisteredPrompt>(),
      resources: new Map<string, RegisteredResource>(),
      resourceTemplates: new Map<string, RegisteredResourceTemplate>(),
    };

    // Replay all registrations on the new server
    // Tools - with context wrapping for ctx.sample(), ctx.elicit()
    for (const [name, registration] of this.registrations.tools) {
      const { config, handler: actualCallback } = registration;
      let inputSchema: Record<string, any>;
      if (config.schema) {
        inputSchema = this.convertZodSchemaToParams(config.schema);
      } else if (config.inputs && config.inputs.length > 0) {
        inputSchema = this.createParamsSchema(config.inputs);
      } else {
        inputSchema = {};
      }

      // Wrap handler to provide enhanced context
      const wrappedHandler = async (
        params: Record<string, unknown>,
        extra?: {
          _meta?: { progressToken?: number };
          sendNotification?: (notification: {
            method: string;
            params: Record<string, unknown>;
          }) => Promise<void>;
        }
      ) => {
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
        const createMessageWithLogging = async (
          params: CreateMessageRequest["params"],
          options?: { timeout?: number }
        ): Promise<CreateMessageResult> => {
          console.log("[createMessage] About to call server.createMessage");
          console.log("[createMessage] Has server:", !!newServer);
          try {
            const result = await newServer.server.createMessage(
              params,
              options
            );
            console.log("[createMessage] Got result successfully");
            return result;
          } catch (err: unknown) {
            const error = err as Error & { code?: string };
            console.error(
              "[createMessage] Error:",
              error.message,
              "Code:",
              error.code
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

        const startTime = Date.now();
        let success = true;
        let errorType: string | null = null;

        try {
          const result = requestContext
            ? await runWithContext(requestContext, executeCallback)
            : await executeCallback();
          return result;
        } catch (err) {
          success = false;
          errorType = err instanceof Error ? err.name : "unknown_error";
          throw err;
        } finally {
          const executionTimeMs = Date.now() - startTime;
          Telemetry.getInstance()
            .trackServerToolCall({
              toolName: name,
              lengthInputArgument: JSON.stringify(params).length,
              success,
              errorType,
              executionTimeMs,
            })
            .catch((e) => console.debug(`Failed to track tool call: ${e}`));
        }
      };

      const registeredTool = newServer.registerTool(
        name,
        {
          title: config.title,
          description: config.description ?? "",
          inputSchema,
          annotations: config.annotations,
          _meta: config._meta,
        },
        wrappedHandler as any
      );

      // Store ref for hot reload support
      sessionRefs.tools.set(name, registeredTool);
    }

    // Prompts
    for (const [name, registration] of this.registrations.prompts) {
      const { config, handler } = registration;

      // Determine input schema - prefer schema over args
      let argsSchema: Record<string, z.ZodSchema> | undefined;
      if (config.schema) {
        argsSchema = this.convertZodSchemaToParams(config.schema);
      } else if (config.args && config.args.length > 0) {
        argsSchema = this.createParamsSchema(config.args);
      } else {
        // No schema validation when neither schema nor args are provided
        argsSchema = undefined;
      }

      // Wrap handler to support both CallToolResult and GetPromptResult
      const wrappedHandler = async (
        params: Record<string, unknown>,
        extra?: any
      ) => {
        let success = true;
        let errorType: string | null = null;

        try {
          const result = await (handler as any)(params, extra);

          // If it's already a GetPromptResult, return as-is
          if ("messages" in result && Array.isArray(result.messages)) {
            return result as any;
          }

          // Convert CallToolResult to GetPromptResult
          const { convertToolResultToPromptResult } =
            await import("./prompts/conversion.js");
          return convertToolResultToPromptResult(result) as any;
        } catch (err) {
          success = false;
          errorType = err instanceof Error ? err.name : "unknown_error";
          throw err;
        } finally {
          Telemetry.getInstance()
            .trackServerPromptCall({
              name,
              description: config.description ?? null,
              success,
              errorType,
            })
            .catch((e) => console.debug(`Failed to track prompt call: ${e}`));
        }
      };

      const registeredPrompt = newServer.registerPrompt(
        name,
        {
          title: config.title,
          description: config.description ?? "",
          argsSchema: argsSchema as any,
        },
        wrappedHandler as any
      );

      // Store ref for hot reload support
      sessionRefs.prompts.set(name, registeredPrompt);
    }

    // Resources
    for (const [_key, registration] of this.registrations.resources) {
      const { config, handler } = registration;
      // Wrap handler to support both CallToolResult and ReadResourceResult
      const wrappedHandler = async (extra?: any) => {
        let success = true;
        let errorType: string | null = null;
        let contents: any[] = [];

        try {
          const result = await (handler as any)(extra);
          // If it's already a ReadResourceResult, return as-is
          if ("contents" in result && Array.isArray(result.contents)) {
            contents = result.contents;
            return result as any;
          }
          // Convert CallToolResult to ReadResourceResult
          // Import convertToolResultToResourceResult dynamically to avoid circular dependencies
          const { convertToolResultToResourceResult } =
            await import("./resources/conversion.js");
          const converted = convertToolResultToResourceResult(
            config.uri,
            result
          ) as any;
          contents = converted.contents || [];
          return converted;
        } catch (err) {
          success = false;
          errorType = err instanceof Error ? err.name : "unknown_error";
          throw err;
        } finally {
          Telemetry.getInstance()
            .trackServerResourceCall({
              name: config.name,
              description: config.description ?? null,
              contents: contents.map((c: any) => ({
                mime_type: c.mimeType ?? null,
                text: c.text ? `[text: ${c.text.length} chars]` : null,
                blob: c.blob ? `[blob: ${c.blob.length} bytes]` : null,
              })),
              success,
              errorType,
            })
            .catch((e) => console.debug(`Failed to track resource call: ${e}`));
        }
      };

      const registeredResource = newServer.registerResource(
        config.name,
        config.uri,
        {
          title: config.title,
          description: config.description,
          mimeType: config.mimeType || "text/plain",
        } as any,
        wrappedHandler as any
      );

      // Store ref for hot reload support (use same key as registrations.resources)
      const resourceKey = `${config.name}:${config.uri}`;
      sessionRefs.resources.set(resourceKey, registeredResource);
    }

    // Resource Templates
    for (const [_name, registration] of this.registrations.resourceTemplates) {
      const { config, handler } = registration;

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

      const resourceCallbacks: ResourceTemplateCallbacks | undefined =
        isFlatStructure
          ? (config as any).callbacks
          : config.resourceTemplate.callbacks;

      // Create ResourceTemplate instance from SDK
      const template = new ResourceTemplate(uriTemplate, {
        list: undefined,
        complete: toResourceTemplateCompleteCallbacks(
          resourceCallbacks?.complete
        ),
      });

      // Create metadata object
      const metadata: Record<string, unknown> = {};
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

      const registeredResourceTemplate = newServer.registerResource(
        config.name,
        template,
        metadata as any,
        async (uri: URL, extra?: any) => {
          let success = true;
          let errorType: string | null = null;
          let contents: any[] = [];

          try {
            // Parse URI parameters from the template
            const params = this.parseTemplateUri(uriTemplate, uri.toString());
            const result = await (handler as any)(uri, params, extra);

            // If it's already a ReadResourceResult, return as-is
            if ("contents" in result && Array.isArray(result.contents)) {
              contents = result.contents;
              return result as any;
            }

            // Convert CallToolResult to ReadResourceResult
            const { convertToolResultToResourceResult } =
              await import("./resources/conversion.js");
            const converted = convertToolResultToResourceResult(
              uri.toString(),
              result
            ) as any;
            contents = converted.contents || [];
            return converted;
          } catch (err) {
            success = false;
            errorType = err instanceof Error ? err.name : "unknown_error";
            throw err;
          } finally {
            Telemetry.getInstance()
              .trackServerResourceCall({
                name: config.name,
                description: config.description ?? null,
                contents: contents.map((c: any) => ({
                  mimeType: c.mimeType ?? null,
                  text: c.text ? `[text: ${c.text.length} chars]` : null,
                  blob: c.blob ? `[blob: ${c.blob.length} bytes]` : null,
                })),
                success,
                errorType,
              })
              .catch((e) =>
                console.debug(`Failed to track resource template call: ${e}`)
              );
          }
        }
      );

      // Store ref for hot reload support
      // Note: registerResource returns RegisteredResourceTemplate when given a template
      sessionRefs.resourceTemplates.set(
        config.name,
        registeredResourceTemplate as unknown as RegisteredResourceTemplate
      );
    }

    // Register logging/setLevel handler per MCP specification
    newServer.server.setRequestHandler(
      z.object({ method: z.literal("logging/setLevel") }).passthrough(),
      (async (request: { params?: { level?: string } }, extra?: any) => {
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
      }) as any
    );

    // Register resource subscription handlers
    this.subscriptionManager.registerHandlers(newServer, this.sessions);

    // Store refs for hot reload support (if sessionId provided)
    if (sessionId) {
      this.sessionRegisteredRefs.set(sessionId, sessionRefs);
    }

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

  /**
   * Registers a tool that can be called by MCP clients.
   *
   * Tools are executable functions that clients can invoke to perform actions
   * like reading files, making API calls, running commands, etc. Each tool has
   * a name, description, input schema, and callback function.
   *
   * @param toolDefinition - Tool configuration object
   * @param toolDefinition.name - Unique tool name (used by clients to call it)
   * @param toolDefinition.description - Human-readable description of what the tool does
   * @param toolDefinition.schema - Zod schema for validating input parameters
   * @param toolDefinition.cb - Optional callback function (can also be second parameter)
   * @param callback - Optional callback function (alternative to toolDefinition.cb)
   * @returns This server instance for method chaining
   *
   * @example
   * ```typescript
   * // Basic tool
   * server.tool({
   *   name: 'get-time',
   *   description: 'Get current time'
   * }, async () => {
   *   return text(new Date().toISOString());
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Tool with parameters
   * server.tool({
   *   name: 'add',
   *   description: 'Add two numbers',
   *   schema: z.object({
   *     a: z.number(),
   *     b: z.number()
   *   })
   * }, async ({ a, b }) => {
   *   return text(String(a + b));
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Tool with context (for OAuth)
   * server.tool({
   *   name: 'user-info',
   *   description: 'Get user information'
   * }, async (params, ctx) => {
   *   if (!ctx.auth) {
   *     return error('Not authenticated');
   *   }
   *   return text(`User: ${ctx.auth.user.email}`);
   * });
   * ```
   *
   * @see {@link ToolDefinition} for all configuration options
   * @see {@link ToolCallback} for callback signature
   */
  public tool!: <T extends ToolDefinition<any, any, HasOAuth>>(
    toolDefinition: T,
    callback?: ToolCallback<InferToolInput<T>, InferToolOutput<T>, HasOAuth>
  ) => this;

  /**
   * Converts a Zod schema to MCP parameter format.
   * @internal Used internally by tool registration
   */
  public convertZodSchemaToParams = convertZodSchemaToParams;

  /**
   * Creates parameter schema from input definitions.
   * @internal Used internally by tool registration
   */
  public createParamsSchema = createParamsSchema;

  /**
   * Parses URI parameters from resource template URIs.
   * @internal Used internally by resource templates
   */
  public parseTemplateUri = parseTemplateUriHelper;

  /**
   * Registers a resource that can be read by MCP clients.
   *
   * Resources represent data or content that clients can access, such as
   * files, database records, API responses, etc. Each resource has a unique
   * URI and returns content when read.
   *
   * @param resourceDefinition - Resource configuration object
   * @param resourceDefinition.name - Resource display name
   * @param resourceDefinition.uri - Unique resource URI (e.g., "file:///path/to/file")
   * @param resourceDefinition.description - Human-readable description
   * @param resourceDefinition.mimeType - MIME type of content (default: "text/plain")
   * @param callback - Callback function that returns resource content
   * @returns This server instance for method chaining
   *
   * @example
   * ```typescript
   * // Static resource
   * server.resource({
   *   name: 'config',
   *   uri: 'app://config',
   *   description: 'Application configuration'
   * }, async () => {
   *   return text(JSON.stringify(config, null, 2));
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Dynamic resource
   * server.resource({
   *   name: 'system-status',
   *   uri: 'system://status',
   *   mimeType: 'application/json'
   * }, async () => {
   *   const status = await getSystemStatus();
   *   return text(JSON.stringify(status));
   * });
   * ```
   *
   * @see {@link ResourceDefinition} for all configuration options
   * @see {@link resourceTemplate} for parameterized resources
   */
  public resource!: (
    resourceDefinition:
      | ResourceDefinition<HasOAuth>
      | import("./types/index.js").ResourceDefinitionWithoutCallback,
    callback?: ReadResourceCallback<HasOAuth>
  ) => this;

  /**
   * Registers a resource template for parameterized resources.
   *
   * Resource templates allow clients to read resources with dynamic URIs
   * by providing a URI template with parameters (e.g., "file:///{path}").
   * When a client reads a URI matching the template, the parameters are
   * extracted and passed to the callback.
   *
   * @param templateDefinition - Resource template configuration
   * @param templateDefinition.name - Template display name
   * @param templateDefinition.uriTemplate - URI template with parameters (e.g., "files:///{id}")
   * @param templateDefinition.description - Human-readable description
   * @param templateDefinition.mimeType - MIME type of content
   * @param callback - Callback receiving URI and extracted parameters
   * @returns This server instance for method chaining
   *
   * @example
   * ```typescript
   * // File resource template
   * server.resourceTemplate({
   *   name: 'files',
   *   uriTemplate: 'file:///{path}',
   *   description: 'Read files by path'
   * }, async (uri, params) => {
   *   const content = await fs.readFile(params.path, 'utf-8');
   *   return text(content);
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Database record template
   * server.resourceTemplate({
   *   name: 'users',
   *   uriTemplate: 'db://users/{id}',
   *   mimeType: 'application/json'
   * }, async (uri, params) => {
   *   const user = await db.users.get(params.id);
   *   return text(JSON.stringify(user));
   * });
   * ```
   *
   * @see {@link ResourceTemplateDefinition} for all configuration options
   * @see {@link resource} for static resources
   */
  public resourceTemplate!: (
    templateDefinition:
      | ResourceTemplateDefinition<HasOAuth>
      | import("./types/index.js").ResourceTemplateDefinitionWithoutCallback
      | import("./types/index.js").FlatResourceTemplateDefinition<HasOAuth>
      | import("./types/index.js").FlatResourceTemplateDefinitionWithoutCallback,
    callback?: ReadResourceTemplateCallback<HasOAuth>
  ) => this;

  /**
   * Registers a prompt template that clients can use.
   *
   * Prompts are reusable templates that help structure conversations with
   * language models. They can accept parameters and return formatted messages
   * ready to send to an LLM.
   *
   * @param promptDefinition - Prompt configuration object
   * @param promptDefinition.name - Unique prompt name
   * @param promptDefinition.description - Human-readable description
   * @param promptDefinition.schema - Zod schema for prompt arguments
   * @param callback - Callback that returns prompt messages
   * @returns This server instance for method chaining
   *
   * @example
   * ```typescript
   * // Simple prompt
   * server.prompt({
   *   name: 'greeting',
   *   description: 'Generate a greeting message'
   * }, async () => {
   *   return {
   *     messages: [
   *       { role: 'user', content: { type: 'text', text: 'Hello!' } }
   *     ]
   *   };
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Parameterized prompt
   * server.prompt({
   *   name: 'code-review',
   *   description: 'Review code with specific focus',
   *   schema: z.object({
   *     code: z.string(),
   *     focus: z.enum(['security', 'performance', 'style'])
   *   })
   * }, async ({ code, focus }) => {
   *   return {
   *     messages: [
   *       {
   *         role: 'user',
   *         content: {
   *           type: 'text',
   *           text: `Review this code focusing on ${focus}:\n\n${code}`
   *         }
   *       }
   *     ]
   *   };
   * });
   * ```
   *
   * @see {@link PromptDefinition} for all configuration options
   */
  public prompt!: (
    promptDefinition:
      | PromptDefinition<any, HasOAuth>
      | import("./types/index.js").PromptDefinitionWithoutCallback,
    callback?: PromptCallback<any, HasOAuth>
  ) => this;

  /**
   * Gets all active client sessions.
   *
   * @returns Array of active session IDs
   *
   * @example
   * ```typescript
   * const sessions = server.getActiveSessions();
   * console.log(`Active sessions: ${sessions.length}`);
   * ```
   */
  public getActiveSessions = getActiveSessions;

  /**
   * Sends a notification to all connected clients.
   *
   * @param method - Notification method name
   * @param params - Notification parameters
   *
   * @example
   * ```typescript
   * await server.sendNotification('custom/event', { data: 'value' });
   * ```
   */
  public sendNotification = sendNotification;

  /**
   * Sends a notification to a specific client session.
   *
   * @param sessionId - Target session ID
   * @param method - Notification method name
   * @param params - Notification parameters
   *
   * @example
   * ```typescript
   * await server.sendNotificationToSession('session-123', 'custom/event', { data: 'value' });
   * ```
   */
  public sendNotificationToSession = sendNotificationToSession;

  /**
   * Notifies all clients that the tools list has changed.
   * Clients should refresh their tools list.
   *
   * @example
   * ```typescript
   * server.tool({ name: 'new-tool', description: 'New tool' }, handler);
   * await server.sendToolsListChanged();
   * ```
   */
  public sendToolsListChanged = sendToolsListChanged;

  /**
   * Notifies all clients that the resources list has changed.
   * Clients should refresh their resources list.
   *
   * @example
   * ```typescript
   * server.resource({ name: 'new-resource', uri: 'new://' }, handler);
   * await server.sendResourcesListChanged();
   * ```
   */
  public sendResourcesListChanged = sendResourcesListChanged;

  /**
   * Notifies all clients that the prompts list has changed.
   * Clients should refresh their prompts list.
   *
   * @example
   * ```typescript
   * server.prompt({ name: 'new-prompt', description: 'New prompt' }, handler);
   * await server.sendPromptsListChanged();
   * ```
   */
  public sendPromptsListChanged = sendPromptsListChanged;

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

  /**
   * Registers a UI resource for interactive widgets.
   *
   * UI resources allow serving interactive components that can be displayed
   * in compatible MCP clients (like ChatGPT with Apps SDK).
   *
   * @param definition - UI resource definition
   * @returns This server instance for method chaining
   *
   * @example
   * ```typescript
   * server.uiResource({
   *   name: 'chart-viewer',
   *   uri: 'ui://chart',
   *   html: '<div>Chart goes here</div>'
   * });
   * ```
   *
   * @see {@link UIResourceDefinition} for configuration options
   */
  public uiResource = (
    definition: Parameters<typeof uiResourceRegistration>[1]
  ) => {
    return uiResourceRegistration(this as any, definition);
  };

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
   * Starts the HTTP server and begins listening for connections.
   *
   * This method is the primary way to run an MCP server as a standalone HTTP service.
   * It performs the following initialization:
   * 1. Mounts MCP protocol endpoints at `/mcp` and `/sse`
   * 2. Mounts inspector UI at `/inspector` (if available)
   * 3. Mounts widget serving routes
   * 4. Sets up OAuth routes (if configured)
   * 5. Starts the HTTP server on the specified port
   *
   * Port resolution (in order of priority):
   * 1. `port` parameter
   * 2. `--port` CLI argument
   * 3. `PORT` environment variable
   * 4. Default: 3000
   *
   * Host configuration:
   * - Uses `config.host` or `HOST` environment variable
   * - Defaults to "localhost"
   *
   * Base URL:
   * - Uses `config.baseUrl` or `MCP_URL` environment variable
   * - Falls back to `http://${host}:${port}`
   *
   * @param port - Optional port number to listen on
   * @returns Promise that resolves when the server is listening
   *
   * @example
   * ```typescript
   * // Basic usage
   * const server = new MCPServer({ name: 'my-server', version: '1.0.0' });
   * server.tool({ name: 'hello', description: 'Say hello' }, async () => {
   *   return text('Hello, world!');
   * });
   * await server.listen(3000);
   * // Server running at: http://localhost:3000
   * // MCP endpoint: http://localhost:3000/mcp
   * // Inspector UI: http://localhost:3000/inspector
   * ```
   *
   * @example
   * ```typescript
   * // Using environment variables
   * // PORT=8080 HOST=0.0.0.0 node server.js
   * await server.listen(); // Listens on 0.0.0.0:8080
   * ```
   *
   * @example
   * ```typescript
   * // With custom base URL (e.g., behind reverse proxy)
   * const server = new MCPServer({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   baseUrl: 'https://api.example.com'
   * });
   * await server.listen(3000);
   * // Server listens on port 3000 but generates URLs with https://api.example.com
   * ```
   *
   * @example
   * ```typescript
   * // Command-line usage
   * // node server.js --port 8080
   * await server.listen(); // Uses port from CLI argument
   * ```
   *
   * @see {@link getHandler} for serverless deployment without listen()
   */
  /**
   * Logs registered tools, prompts, and resources to console.
   * @internal
   */
  private logRegisteredItems(): void {
    logRegisteredItemsHelper(
      this.registeredTools,
      this.registeredPrompts,
      this.registeredResources
    );
  }

  /**
   * Gets the build identifier for cache busting.
   *
   * @returns Build ID string or undefined
   * @internal
   */
  public getBuildId() {
    return this.buildId;
  }

  /**
   * Gets the port number the server is listening on.
   *
   * @returns Port number (defaults to 3000 if not yet listening)
   *
   * @example
   * ```typescript
   * await server.listen(8080);
   * console.log(`Server port: ${server.getServerPort()}`); // 8080
   * ```
   */
  public getServerPort() {
    return this.serverPort || 3000;
  }

  /**
   * Creates a message using sampling (LLM completion).
   *
   * This method delegates to the native SDK server to handle sampling requests.
   * Sampling allows tools to ask the LLM to generate responses, enabling
   * agent-like behavior where tools can request LLM assistance.
   *
   * @param params - Message creation parameters
   * @param options - Optional request options
   * @returns Message creation result from the LLM
   *
   * @example
   * ```typescript
   * // In a tool callback with sampling capability
   * const result = await server.createMessage({
   *   messages: [
   *     { role: 'user', content: { type: 'text', text: 'Explain MCP' } }
   *   ],
   *   maxTokens: 100
   * });
   * ```
   */
  public async createMessage(
    params: CreateMessageRequest["params"],
    options?: any
  ): Promise<CreateMessageResult> {
    return await this.nativeServer.server.createMessage(params, options);
  }

  async listen(port?: number): Promise<void> {
    // During HMR reload, skip listen() - CLI manages the server lifecycle
    if ((globalThis as any).__mcpUseHmrMode) {
      return;
    }

    // Priority: parameter > --port CLI arg > PORT env var > default (3000)
    const portEnv = getEnv("PORT");

    // Parse --port from command-line arguments
    let cliPort: number | undefined;
    if (typeof process !== "undefined" && Array.isArray(process.argv)) {
      const portArgIndex = process.argv.indexOf("--port");
      if (portArgIndex !== -1 && portArgIndex + 1 < process.argv.length) {
        const portValue = parseInt(process.argv[portArgIndex + 1], 10);
        if (!isNaN(portValue)) {
          cliPort = portValue;
        }
      }
    }

    this.serverPort =
      port || cliPort || (portEnv ? parseInt(portEnv, 10) : 3000);

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
    if (this.oauthProvider && !this.oauthSetupState.complete) {
      await setupOAuthForServer(
        this.app,
        this.oauthProvider,
        this.getServerBaseUrl(),
        this.oauthSetupState
      );
    }

    await mountWidgets(this as any, {
      baseRoute: "/mcp-use/widgets",
      resourcesDir: "resources",
    });
    await this.mountMcp();

    // Mount inspector BEFORE Vite middleware to ensure it handles /inspector routes
    await this.mountInspector();

    // Log registered items before starting server
    this.logRegisteredItems();

    // Track server run event
    this._trackServerRun("http");

    // Start server using runtime-aware helper
    await startServer(this.app, this.serverPort, this.serverHost, {
      onDenoRequest: rewriteSupabaseRequest,
    });
  }

  private _trackServerRun(transport: string): void {
    Telemetry.getInstance()
      .trackServerRunFromServer(this, transport)
      .catch((e) => console.debug(`Failed to track server run: ${e}`));
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
    if (this.oauthProvider && !this.oauthSetupState.complete) {
      await setupOAuthForServer(
        this.app,
        this.oauthProvider,
        this.getServerBaseUrl(),
        this.oauthSetupState
      );
    }

    console.log("[MCP] Mounting widgets");
    await mountWidgets(this as any, {
      baseRoute: "/mcp-use/widgets",
      resourcesDir: "resources",
    });
    console.log("[MCP] Mounted widgets");
    await this.mountMcp();
    console.log("[MCP] Mounted MCP");
    console.log("[MCP] Mounting inspector");
    await this.mountInspector();
    console.log("[MCP] Mounted inspector");

    const provider = options?.provider || "fetch";
    this._trackServerRun(provider);

    // Wrap the fetch handler to ensure it always returns a Promise<Response>
    const fetchHandler = this.app.fetch.bind(this.app);

    // Handle platform-specific path rewriting and CORS
    if (options?.provider === "supabase") {
      return async (req: Request) => {
        const corsHeaders = getDenoCorsHeaders();

        // Handle CORS preflight
        if (req.method === "OPTIONS") {
          return new Response("ok", { headers: corsHeaders });
        }

        // Rewrite path and process request
        const rewrittenReq = rewriteSupabaseRequest(req);
        const result = await fetchHandler(rewrittenReq);

        // Apply CORS headers to response
        return applyDenoCorsHeaders(result);
      };
    }

    return async (req: Request) => {
      const result = await fetchHandler(req);
      return result;
    };
  }

  /**
   * Registers a callback for when client roots change.
   *
   * Roots represent directories or files that the client has access to.
   * This callback is invoked when a client updates its root list.
   *
   * @param callback - Function to call when roots change
   *
   * @example
   * ```typescript
   * server.onRootsChanged((roots) => {
   *   console.log(`Client roots updated: ${roots.length} roots`);
   *   roots.forEach(root => console.log(`  - ${root.uri}`));
   * });
   * ```
   */
  onRootsChanged = onRootsChanged.bind(this);

  /**
   * Lists the current roots from connected clients.
   *
   * @returns Promise resolving to array of Root objects
   *
   * @example
   * ```typescript
   * const roots = await server.listRoots();
   * console.log(`Current roots: ${roots.map(r => r.uri).join(', ')}`);
   * ```
   */
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

export type McpServerInstance<HasOAuth extends boolean = false> =
  MCPServerClass<HasOAuth> & HonoType;

// Type alias for use in type annotations (e.g., function parameters)
export type MCPServer<HasOAuth extends boolean = false> =
  MCPServerClass<HasOAuth>;

// Interface to properly type the MCPServer constructor with OAuth overloads
export interface MCPServerConstructor {
  // Overload: when OAuth is configured, return McpServerInstance<true>
  new (
    config: ServerConfig & { oauth: NonNullable<ServerConfig["oauth"]> }
  ): McpServerInstance<true>;
  // Overload: when OAuth is not configured, return McpServerInstance<false>
  new (config: ServerConfig): McpServerInstance<false>;
  prototype: MCPServerClass<boolean>;
}

// Export MCPServer constructor with proper return typing
// This allows both: `function foo(server: MCPServer)` and `new MCPServer()`
// TypeScript allows both a type and a const with the same name (declaration merging)
// eslint-disable-next-line @typescript-eslint/no-redeclare, no-redeclare
export const MCPServer: MCPServerConstructor = MCPServerClass as any;

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
 * @param config.sessionIdleTimeoutMs - Idle timeout for sessions in milliseconds (default: 86400000 = 1 day)
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

/**
 * @deprecated Use `new MCPServer({ name, ... })` instead. This factory function is maintained for backward compatibility.
 *
 * @example
 * ```typescript
 * // Old (deprecated)
 * const server = createMCPServer('my-server', { version: '1.0.0' })
 *
 * // New (recommended)
 * const server = new MCPServer({ name: 'my-server', version: '1.0.0' })
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
  const instance = new MCPServerClass({
    name,
    version: config.version || "1.0.0",
    description: config.description,
    title: config.title,
    websiteUrl: config.websiteUrl,
    icons: config.icons,
    host: config.host,
    baseUrl: config.baseUrl,
    allowedOrigins: config.allowedOrigins,
    sessionIdleTimeoutMs: config.sessionIdleTimeoutMs,
    autoCreateSessionOnInvalidId: config.autoCreateSessionOnInvalidId,
    oauth: config.oauth,
    favicon: config.favicon,
  }) as any;

  return instance as unknown as McpServerInstance<boolean>;
}
