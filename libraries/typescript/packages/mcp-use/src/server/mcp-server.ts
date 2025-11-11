import {
  McpServer as OfficialMcpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { Hono, type Context, type Hono as HonoType, type Next } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  createUIResourceFromDefinition,
  type UrlConfig,
} from "./adapters/mcp-ui-adapter.js";
import { adaptConnectMiddleware } from "./connect-adapter.js";
import { requestLogger } from "./logging.js";
import type {
  InputDefinition,
  PromptDefinition,
  ResourceDefinition,
  ResourceTemplateDefinition,
  ServerConfig,
  ToolDefinition,
  UIResourceContent,
  UIResourceDefinition,
  WidgetProps,
} from "./types/index.js";
import type { WidgetMetadata } from "./types/widget.js";

const TMP_MCP_USE_DIR = ".mcp-use";

// Runtime detection
const isDeno = typeof (globalThis as any).Deno !== "undefined";

// Helper to get environment variable
function getEnv(key: string): string | undefined {
  if (isDeno) {
    return (globalThis as any).Deno.env.get(key);
  }
  return process.env[key];
}

// Helper to get current working directory
function getCwd(): string {
  if (isDeno) {
    return (globalThis as any).Deno.cwd();
  }
  return process.cwd();
}

// Runtime-aware file system helpers
const fsHelpers = {
  async readFileSync(path: string, encoding: string = "utf8"): Promise<string> {
    if (isDeno) {
      return await (globalThis as any).Deno.readTextFile(path);
    }
    const { readFileSync } = await import("node:fs");
    const result = readFileSync(path, encoding as any);
    return typeof result === "string" ? result : result.toString(encoding as any);
  },
  
  async readFile(path: string): Promise<ArrayBuffer> {
    if (isDeno) {
      const data = await (globalThis as any).Deno.readFile(path);
      return data.buffer;
    }
    const { readFileSync } = await import("node:fs");
    const buffer = readFileSync(path);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  },
  
  async existsSync(path: string): Promise<boolean> {
    if (isDeno) {
      try {
        await (globalThis as any).Deno.stat(path);
        return true;
      } catch {
        return false;
      }
    }
    const { existsSync } = await import("node:fs");
    return existsSync(path);
  },
  
  async readdirSync(path: string): Promise<string[]> {
    if (isDeno) {
      const entries = [];
      for await (const entry of (globalThis as any).Deno.readDir(path)) {
        entries.push(entry.name);
      }
      return entries;
    }
    const { readdirSync } = await import("node:fs");
    return readdirSync(path);
  },
};

// Runtime-aware path helpers
const pathHelpers = {
  join(...paths: string[]): string {
    if (isDeno) {
      // Use simple path joining for Deno (web-standard approach)
      return paths.join("/").replace(/\/+/g, "/");
    }
    // For Node, we need to use the sync version or cache the import
    // We'll use a simple implementation that works for both
    return paths.join("/").replace(/\/+/g, "/");
  },
  
  relative(from: string, to: string): string {
    // Simple relative path calculation
    const fromParts = from.split("/").filter(p => p);
    const toParts = to.split("/").filter(p => p);
    
    let i = 0;
    while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
      i++;
    }
    
    const upCount = fromParts.length - i;
    const relativeParts = [...Array(upCount).fill(".."), ...toParts.slice(i)];
    return relativeParts.join("/");
  },
};

export class McpServer {
  private server: OfficialMcpServer;
  private config: ServerConfig;
  private app: HonoType;
  private mcpMounted = false;
  private inspectorMounted = false;
  private serverPort?: number;
  private serverHost: string;
  private serverBaseUrl?: string;

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
      })
    );

    // Request logging middleware
    this.app.use("*", requestLogger);

    // Proxy all Hono methods to the underlying app
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) {
          return (target as any)[prop];
        }
        const value = (target.app as any)[prop];
        return typeof value === "function" ? value.bind(target.app) : value;
      },
    }) as McpServer;
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
        name: resourceDefinition.name,
        title: resourceDefinition.title,
        description: resourceDefinition.description,
        mimeType: resourceDefinition.mimeType,
        annotations: resourceDefinition.annotations,
        _meta: resourceDefinition._meta,
      },
      async () => {
        return await resourceDefinition.readCallback();
      }
    );
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
    if (resourceTemplateDefinition.resourceTemplate.name) {
      metadata.name = resourceTemplateDefinition.resourceTemplate.name;
    }
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
   * @param toolDefinition.description - Human-readable description of what the tool does
   * @param toolDefinition.inputs - Array of input parameter definitions with types and validation
   * @param toolDefinition.cb - Async callback function that executes the tool logic with provided parameters
   * @param toolDefinition._meta - Optional metadata for the tool (e.g. Apps SDK metadata)
   * @returns The server instance for method chaining
   *
   * @example
   * ```typescript
   * server.tool({
   *   name: 'calculate',
   *   description: 'Performs mathematical calculations',
   *   inputs: [
   *     { name: 'expression', type: 'string', required: true },
   *     { name: 'precision', type: 'number', required: false }
   *   ],
   *   cb: async ({ expression, precision = 2 }) => {
   *     const result = eval(expression)
   *     return { result: Number(result.toFixed(precision)) }
   *   },
   *   _meta: {
   *     'openai/outputTemplate': 'ui://widgets/calculator',
   *     'openai/toolInvocation/invoking': 'Calculating...',
   *     'openai/toolInvocation/invoked': 'Calculation complete'
   *   }
   * })
   * ```
   */
  tool(toolDefinition: ToolDefinition): this {
    const inputSchema = this.createParamsSchema(toolDefinition.inputs || []);

    this.server.registerTool(
      toolDefinition.name,
      {
        title: toolDefinition.title,
        description: toolDefinition.description ?? "",
        inputSchema,
        annotations: toolDefinition.annotations,
        _meta: toolDefinition._meta,
      },
      async (params: any) => {
        return await toolDefinition.cb(params);
      }
    );
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
    return this;
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
        resourceUri = `ui://widget/${definition.widget}`;
        mimeType = "text/uri-list";
        break;
      case "rawHtml":
        resourceUri = `ui://widget/${definition.name}`;
        mimeType = "text/html";
        break;
      case "remoteDom":
        resourceUri = `ui://widget/${definition.name}`;
        mimeType = "application/vnd.mcp-ui.remote-dom+javascript";
        break;
      case "appsSdk":
        resourceUri = `ui://widget/${definition.name}.html`;
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

        return {
          contents: [uiResource.resource],
        };
      },
    });

    // For Apps SDK, also register a resource template to handle dynamic URIs with random IDs
    if (definition.type === "appsSdk") {
      this.resourceTemplate({
        name: `${definition.name}-dynamic`,
        resourceTemplate: {
          uriTemplate: `ui://widget/${definition.name}-{id}.html`,
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
      cb: async (params) => {
        // Create the UIResource with user-provided params
        const uiResource = this.createWidgetUIResource(definition, params);

        // For Apps SDK, return _meta at top level with only text in content
        if (definition.type === "appsSdk") {
          // Generate a unique URI with random ID for each invocation
          const randomId = Math.random().toString(36).substring(2, 15);
          const uniqueUri = `ui://widget/${definition.name}-${randomId}.html`;

          // Update toolMetadata with the unique URI
          const uniqueToolMetadata = {
            ...toolMetadata,
            "openai/outputTemplate": uniqueUri,
          };

          return {
            _meta: uniqueToolMetadata,
            content: [
              {
                type: "text",
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
              type: "text",
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
    };

    return createUIResourceFromDefinition(definition, params, urlConfig);
  }

  /**
   * Build a complete URL for a widget including query parameters
   *
   * Constructs the full URL to access a widget's iframe, encoding any provided
   * parameters as query string parameters. Complex objects are JSON-stringified
   * for transmission.
   *
   * @private
   * @param widget - Widget name/identifier
   * @param params - Parameters to encode in the URL
   * @returns Complete URL with encoded parameters
   */
  private buildWidgetUrl(widget: string, params: Record<string, any>): string {
    const baseUrl = `http://${this.serverHost}:${this.serverPort}/mcp-use/widgets/${widget}`;

    if (Object.keys(params).length === 0) {
      return baseUrl;
    }

    const queryParams = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        if (typeof value === "object") {
          queryParams.append(key, JSON.stringify(value));
        } else {
          queryParams.append(key, String(value));
        }
      }
    }

    return `${baseUrl}?${queryParams.toString()}`;
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
        getCwd(),
        "dist",
        ".mcp-use-manifest.json"
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
    if (this.isProductionMode()) {
      await this.mountWidgetsProduction(options);
    } else {
      // Skip dev mode in Deno (no Vite support)
      if (isDeno) {
        console.log("[WIDGETS] Skipping dev mode widget mounting in Deno runtime (use production build)");
        return;
      }
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

    // Find all TSX widget files
    let entries: string[] = [];
    try {
      const files = await fs.readdir(srcDir);
      entries = files
        .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
        .map((f) => pathHelpers.join(srcDir, f));
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
      const viteModule = await new Function('return import("vite")')();
      createServer = viteModule.createServer;
      const reactModule = await new Function('return import("@vitejs/plugin-react")')();
      react = reactModule.default;
      const tailwindModule = await new Function('return import("@tailwindcss/vite")')();
      tailwindcss = tailwindModule.default;
    } catch (error) {
      console.error("[WIDGETS] Dev dependencies not available. Install vite, @vitejs/plugin-react, and @tailwindcss/vite for widget development.");
      console.error("[WIDGETS] For production, use 'mcp-use build' to pre-build widgets.");
      return;
    }

    const widgets = entries.map((entry) => {
      const baseName =
        entry
          .split("/")
          .pop()
          ?.replace(/\.tsx?$/, "") || "widget";
      const widgetName = baseName;
      return {
        name: widgetName,
        description: `Widget: ${widgetName}`,
        entry: entry,
      };
    });

    // Create entry files for each widget
    for (const widget of widgets) {
      // Create temp entry and HTML files for this widget
      const widgetTempDir = pathHelpers.join(tempDir, widget.name);
      await fs.mkdir(widgetTempDir, { recursive: true });

      // Create a CSS file with Tailwind and @source directives to scan resources
      const resourcesPath = pathHelpers.join(getCwd(), resourcesDir);
      const relativeResourcesPath = pathHelpers.relative(
        widgetTempDir,
        resourcesPath
      ).replace(/\\/g, "/");
      const cssContent = `@import "tailwindcss";

/* Configure Tailwind to scan the resources directory */
@source "${relativeResourcesPath}";
`;
      await fs.writeFile(pathHelpers.join(widgetTempDir, "styles.css"), cssContent, "utf8");

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
    const serverOrigin =
      this.serverBaseUrl || `http://${this.serverHost}:${this.serverPort}`;

    // Create a single shared Vite dev server for all widgets
    console.log(
      `[WIDGETS] Serving ${entries.length} widget(s) with shared Vite dev server and HMR`
    );

    const viteServer = await createServer({
      root: tempDir,
      base: baseRoute + "/",
      plugins: [tailwindcss(), react()],
      resolve: {
        alias: {
          "@": pathHelpers.join(getCwd(), resourcesDir),
        },
      },
      server: {
        middlewareMode: true,
        origin: serverOrigin,
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
          if (relativePath === `/${widgetName}` || relativePath === `/${widgetName}/`) {
            // Rewrite the URL for Vite by creating a new request with modified URL
            const newUrl = new URL(c.req.url);
            newUrl.pathname = `${baseRoute}/${widgetName}/index.html`;
            // Create a new request with modified URL and update the context
            const newRequest = new Request(newUrl.toString(), c.req.raw);
            // Update the request in the context by creating a new context-like object
            Object.defineProperty(c, 'req', {
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
    const viteMiddleware = await adaptConnectMiddleware(viteServer.middlewares, `${baseRoute}/*`);
    this.app.use(`${baseRoute}/*`, viteMiddleware);

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

      console.log("[WIDGET dev] Metadata:", metadata);

      let html = "";
      try {
        html = await fsHelpers.readFileSync(
          pathHelpers.join(tempDir, widget.name, "index.html"),
          "utf8"
        );
        // Inject or replace base tag with MCP_URL
        const mcpUrl = getEnv("MCP_URL") || "/";
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

        // replace relative path that starts with /mcp-use script and css with absolute
        html = html.replace(
          /src="\/mcp-use\/widgets\/([^"]+)"/g,
          `src="${this.serverBaseUrl}/mcp-use/widgets/$1"`
        );
        html = html.replace(
          /href="\/mcp-use\/widgets\/([^"]+)"/g,
          `href="${this.serverBaseUrl}/mcp-use/widgets/$1"`
        );

        // add window.__getFile to head
        html = html.replace(
          /<head[^>]*>/i,
          `<head>\n    <script>window.__getFile = (filename) => { return "${this.serverBaseUrl}/mcp-use/widgets/${widget.name}/"+filename }</script>`
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
              ...(this.serverBaseUrl ? [this.serverBaseUrl] : []),
              ...(metadata.appsSdkMetadata?.["openai/widgetCSP"]
                ?.connect_domains || []),
            ],
            resource_domains: [
              "https://*.oaistatic.com",
              "https://*.oaiusercontent.com",
              // always also add the base url of the server
              ...(this.serverBaseUrl ? [this.serverBaseUrl] : []),
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
    const widgetsDir = pathHelpers.join(getCwd(), "dist", "resources", "widgets");

    // Check if widgets directory exists
    if (!(await fsHelpers.existsSync(widgetsDir))) {
      console.log(
        "[WIDGETS] No dist/resources/widgets/ directory found - skipping widget serving"
      );
      return;
    }

    // Setup static file serving routes
    this.setupWidgetRoutes();

    // Discover built widgets
    const allEntries = await fsHelpers.readdirSync(widgetsDir);
    const widgets: string[] = [];
    for (const name of allEntries) {
      const widgetPath = pathHelpers.join(widgetsDir, name);
      const indexPath = pathHelpers.join(widgetPath, "index.html");
      if (await fsHelpers.existsSync(indexPath)) {
        widgets.push(name);
      }
    }

    if (widgets.length === 0) {
      console.log(
        "[WIDGETS] No built widgets found in dist/resources/widgets/"
      );
      return;
    }

    console.log(
      `[WIDGETS] Serving ${widgets.length} pre-built widget(s) from dist/resources/widgets/`
    );

    // Register tools and resources for each widget
    for (const widgetName of widgets) {
      const widgetPath = pathHelpers.join(widgetsDir, widgetName);
      const indexPath = pathHelpers.join(widgetPath, "index.html");
      const metadataPath = pathHelpers.join(widgetPath, "metadata.json");

      // Read the HTML template
      let html = "";
      try {
        html = await fsHelpers.readFileSync(indexPath, "utf8");

        // Inject or replace base tag with MCP_URL
        const mcpUrl = getEnv("MCP_URL") || "/";
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

          // replace relative path that starts with /mcp-use script and css with absolute
          html = html.replace(
            /src="\/mcp-use\/widgets\/([^"]+)"/g,
            `src="${this.serverBaseUrl}/mcp-use/widgets/$1"`
          );
          html = html.replace(
            /href="\/mcp-use\/widgets\/([^"]+)"/g,
            `href="${this.serverBaseUrl}/mcp-use/widgets/$1"`
          );

          // add window.__getFile to head
          html = html.replace(
            /<head[^>]*>/i,
            `<head>\n    <script>window.__getFile = (filename) => { return "${this.serverBaseUrl}/mcp-use/widgets/${widgetName}/"+filename }</script>`
          );
        }
      } catch (error) {
        console.error(
          `[WIDGET] Failed to read ${widgetName}/index.html:`,
          error
        );
        continue;
      }

      // Read the metadata file if it exists
      let metadata: WidgetMetadata = {};
      let props = {};
      let description = `Widget: ${widgetName}`;

      try {
        const metadataContent = await fsHelpers.readFileSync(metadataPath, "utf8");
        metadata = JSON.parse(metadataContent);
        if (metadata.description) {
          description = metadata.description;
        }
        if (metadata.inputs) {
          props = metadata.inputs;
        }
      } catch (error) {
        // Metadata file doesn't exist or couldn't be read - use defaults
        console.log(
          `[WIDGET] No metadata found for ${widgetName}, using defaults`
        );
      }

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
              ...(this.serverBaseUrl ? [this.serverBaseUrl] : []),
              ...(metadata.appsSdkMetadata?.["openai/widgetCSP"]
                ?.connect_domains || []),
            ],
            resource_domains: [
              "https://*.oaistatic.com",
              "https://*.oaiusercontent.com",
              // always also add the base url of the server
              ...(this.serverBaseUrl ? [this.serverBaseUrl] : []),
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
   * Mount MCP server endpoints at /mcp
   *
   * Sets up the HTTP transport layer for the MCP server, creating endpoints for
   * Server-Sent Events (SSE) streaming, POST message handling, and DELETE session cleanup.
   * Each request gets its own transport instance to prevent state conflicts between
   * concurrent client connections.
   *
   * This method is called automatically when the server starts listening and ensures
   * that MCP clients can communicate with the server over HTTP.
   *
   * @private
   * @returns Promise that resolves when MCP endpoints are successfully mounted
   *
   * @example
   * Endpoints created:
   * - GET /mcp - SSE streaming endpoint for real-time communication
   * - POST /mcp - Message handling endpoint for MCP protocol messages
   * - DELETE /mcp - Session cleanup endpoint
   */
  private async mountMcp(): Promise<void> {
    if (this.mcpMounted) return;

    const { StreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/streamableHttp.js"
    );

    const endpoint = "/mcp";

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
        headers: Object.fromEntries(req.headers.entries()),
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
            const data = typeof chunk === "string"
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
            const data = typeof chunk === "string"
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

      return { expressReq, expressRes, getResponse: () => {
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
      }};
    };

    // POST endpoint for messages
    // Create a new transport for each request to support multiple concurrent clients
    this.app.post(endpoint, async (c: Context) => {
      const { expressReq, expressRes, getResponse } = createExpressLikeObjects(c);
      
      // Get request body
      try {
        expressReq.body = await c.req.json();
      } catch {
        expressReq.body = {};
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      // Handle close event
      if (expressRes._closeHandler) {
        // Note: In web-standard Request/Response, we use AbortController
        // For now, we'll call close when response is done
        c.req.raw.signal?.addEventListener("abort", () => {
          transport.close();
        });
      }

      await this.server.connect(transport);
      
      // Wait for handleRequest to complete and for response to be written
      await transport.handleRequest(expressReq, expressRes, expressReq.body);
      
      // Wait a tiny bit for async writes to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      const response = getResponse();
      if (response) {
        return response;
      }

      // If no response was written, return empty response
      return c.text("", 200);
    });

    // GET endpoint for SSE streaming
    this.app.get(endpoint, async (c: Context) => {
      const { expressReq, expressRes, getResponse } = createExpressLikeObjects(c);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      // Handle close event
      c.req.raw.signal?.addEventListener("abort", () => {
        transport.close();
      });

      await this.server.connect(transport);
      await transport.handleRequest(expressReq, expressRes);
      
      // Wait a tiny bit for async writes to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      const response = getResponse();
      if (response) {
        return response;
      }

      return c.text("", 200);
    });

    // DELETE endpoint for session cleanup
    this.app.delete(endpoint, async (c: Context) => {
      const { expressReq, expressRes, getResponse } = createExpressLikeObjects(c);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      // Handle close event
      c.req.raw.signal?.addEventListener("abort", () => {
        transport.close();
      });

      await this.server.connect(transport);
      await transport.handleRequest(expressReq, expressRes);
      
      // Wait a tiny bit for async writes to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      const response = getResponse();
      if (response) {
        return response;
      }

      return c.text("", 200);
    });

    this.mcpMounted = true;
    console.log(`[MCP] Server mounted at ${endpoint}`);
  }

  /**
   * Start the Hono server with MCP endpoints
   *
   * Initiates the server startup process by mounting MCP endpoints, configuring
   * the inspector UI (if available), and starting the server to listen
   * for incoming connections. This is the main entry point for running the server.
   *
   * The server will be accessible at the specified port with MCP endpoints at /mcp
   * and inspector UI at /inspector (if the inspector package is installed).
   *
   * @param port - Port number to listen on (defaults to 3001 if not specified)
   * @returns Promise that resolves when the server is successfully listening
   *
   * @example
   * ```typescript
   * await server.listen(8080)
   * // Server now running at http://localhost:8080 (or configured host)
   * // MCP endpoints: http://localhost:8080/mcp
   * // Inspector UI: http://localhost:8080/inspector
   * ```
   */
  async listen(port?: number): Promise<void> {
    // Priority: parameter > PORT env var > default (3001)
    const portEnv = getEnv("PORT");
    this.serverPort =
      port || (portEnv ? parseInt(portEnv, 10) : 3001);

    // Update host from HOST env var if set
    const hostEnv = getEnv("HOST");
    if (hostEnv) {
      this.serverHost = hostEnv;
    }

    await this.mountWidgets({
      baseRoute: "/mcp-use/widgets",
      resourcesDir: "resources",
    });
    await this.mountMcp();

    // Mount inspector BEFORE Vite middleware to ensure it handles /inspector routes
    await this.mountInspector();

    // Start server based on runtime
    if (isDeno) {
      (globalThis as any).Deno.serve(
        { port: this.serverPort, hostname: this.serverHost },
        this.app.fetch
      );
      console.log(
        `[SERVER] Listening on http://${this.serverHost}:${this.serverPort}`
      );
      console.log(
        `[MCP] Endpoints: http://${this.serverHost}:${this.serverPort}/mcp`
      );
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
            `[MCP] Endpoints: http://${this.serverHost}:${this.serverPort}/mcp`
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
  async getHandler(options?: { provider?: 'supabase' | 'cloudflare' | 'deno-deploy' }): Promise<(req: Request) => Promise<Response>> {
    await this.mountWidgets({
      baseRoute: "/mcp-use/widgets",
      resourcesDir: "resources",
    });
    await this.mountMcp();
    await this.mountInspector();

    // Wrap the fetch handler to ensure it always returns a Promise<Response>
    const fetchHandler = this.app.fetch.bind(this.app);
    
    // Handle platform-specific path rewriting
    if (options?.provider === 'supabase') {
      return async (req: Request) => {
        const url = new URL(req.url);
        const pathname = url.pathname;
        
        // Supabase includes the function name in the path (e.g., /functions/v1/mcp-server/mcp or /mcp-server/mcp)
        // Use regex to detect and strip the function name prefix before /functions or after the function name
        // Pattern: /functions/v1/{function-name}/... or /{function-name}/...
        let newPathname = pathname;
        
        // Match /functions/v1/{anything}/... and strip up to the function name
        const functionsMatch = pathname.match(/^\/functions\/v1\/[^/]+(\/.*)?$/);
        if (functionsMatch) {
          // Extract everything after the function name
          newPathname = functionsMatch[1] || '/';
        } else {
          // Match /{function-name}/... pattern (when function name is in path but not /functions)
          // This handles cases where Supabase might pass /mcp-server/mcp
          const functionNameMatch = pathname.match(/^\/([^/]+)(\/.*)?$/);
          if (functionNameMatch && functionNameMatch[2]) {
            // If there's a path after the function name, use it
            // Otherwise, if the path is just /{function-name}, default to /
            newPathname = functionNameMatch[2] || '/';
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
   * - Automatically connects to http://localhost:PORT/mcp
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
      // Auto-connect to the local MCP server at /mcp
      mountInspector(this.app);
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
      const widgetsDir = pathHelpers.join(getCwd(), "dist", "resources", "widgets");

      try {
        const widgets = await fsHelpers.readdirSync(widgetsDir);
        for (const widget of widgets) {
          const assetPath = pathHelpers.join(widgetsDir, widget, "assets", assetFile);
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
        // replace relative path that starts with /mcp-use script and css with absolute
        html = html.replace(
          /src="\/mcp-use\/widgets\/([^"]+)"/g,
          `src="${this.serverBaseUrl}/mcp-use/widgets/$1"`
        );
        html = html.replace(
          /href="\/mcp-use\/widgets\/([^"]+)"/g,
          `href="${this.serverBaseUrl}/mcp-use/widgets/$1"`
        );

        // add window.__getFile to head
        html = html.replace(
          /<head[^>]*>/i,
          `<head>\n    <script>window.__getFile = (filename) => { return "${this.serverBaseUrl}/mcp-use/widgets/${widget}/"+filename }</script>`
        );

        return c.html(html);
      } catch {
        return c.notFound();
      }
    });
  }

  /**
   * Create input schema for resource templates
   *
   * Parses a URI template string to extract parameter names and generates a Zod
   * validation schema for those parameters. Used internally for validating resource
   * template parameters before processing requests.
   *
   * @param uriTemplate - URI template string with parameter placeholders (e.g., "/users/{id}/posts/{postId}")
   * @returns Object mapping parameter names to Zod string schemas
   *
   * @example
   * ```typescript
   * const schema = this.createInputSchema("/users/{id}/posts/{postId}")
   * // Returns: { id: z.string(), postId: z.string() }
   * ```
   */
  private createInputSchema(uriTemplate: string): Record<string, z.ZodSchema> {
    const params = this.extractTemplateParams(uriTemplate);
    const schema: Record<string, z.ZodSchema> = {};

    params.forEach((param) => {
      schema[param] = z.string();
    });

    return schema;
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
   * Create arguments schema for prompts
   *
   * Converts prompt argument definitions into Zod validation schemas for runtime validation.
   * Supports common data types (string, number, boolean, object, array) and optional
   * parameters. Used internally when registering prompt templates with the MCP server.
   *
   * @param inputs - Array of argument definitions with name, type, and optional flag
   * @returns Object mapping argument names to Zod validation schemas
   *
   * @example
   * ```typescript
   * const schema = this.createPromptArgsSchema([
   *   { name: 'topic', type: 'string', required: true },
   *   { name: 'style', type: 'string', required: false }
   * ])
   * // Returns: { topic: z.string(), style: z.string().optional() }
   * ```
   */
  private createPromptArgsSchema(
    inputs: Array<{ name: string; type: string; required?: boolean }>
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

      if (!input.required) {
        zodType = zodType.optional();
      }

      schema[input.name] = zodType;
    });

    return schema;
  }

  /**
   * Extract parameter names from URI template
   *
   * Parses a URI template string to extract parameter names enclosed in curly braces.
   * Used internally to identify dynamic parameters in resource templates and generate
   * appropriate validation schemas.
   *
   * @param uriTemplate - URI template string with parameter placeholders (e.g., "/users/{id}/posts/{postId}")
   * @returns Array of parameter names found in the template
   *
   * @example
   * ```typescript
   * const params = this.extractTemplateParams("/users/{id}/posts/{postId}")
   * // Returns: ["id", "postId"]
   * ```
   */
  private extractTemplateParams(uriTemplate: string): string[] {
    const matches = uriTemplate.match(/\{([^}]+)\}/g);
    return matches ? matches.map((match) => match.slice(1, -1)) : [];
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

export type McpServerInstance = Omit<McpServer, keyof HonoType> & HonoType & {
  getHandler: (options?: { provider?: 'supabase' | 'cloudflare' | 'deno-deploy' }) => Promise<(req: Request) => Promise<Response>>;
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
 * @returns McpServerInstance with both MCP and Hono methods
 *
 * @example
 * ```typescript
 * // Basic usage
 * const server = createMCPServer('my-server', {
 *   version: '1.0.0',
 *   description: 'My MCP server'
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
  });
  return instance as unknown as McpServerInstance;
}
