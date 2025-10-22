import type {
  PromptDefinition,
  ResourceDefinition,
  ResourceTemplateDefinition,
  ServerConfig,
  ToolDefinition,
  UIResourceDefinition,
  WidgetProps,
  InputDefinition,
  UIResourceContent,
} from './types/index.js'
import { McpServer as OfficialMcpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import express, { type Express } from 'express'
import cors from 'cors'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { requestLogger } from './logging.js'
import { createUIResourceFromDefinition, type UrlConfig } from './adapters/mcp-ui-adapter.js'
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js'

export class McpServer {
  private server: OfficialMcpServer
  private config: ServerConfig
  private app: Express
  private mcpMounted = false
  private inspectorMounted = false
  private serverPort?: number

  /**
   * Creates a new MCP server instance with Express integration
   *
   * Initializes the server with the provided configuration, sets up CORS headers,
   * configures widget serving routes, and creates a proxy that allows direct
   * access to Express methods while preserving MCP server functionality.
   *
   * @param config - Server configuration including name, version, and description
   * @returns A proxied McpServer instance that supports both MCP and Express methods
   */
  constructor(config: ServerConfig) {
    this.config = config
    this.server = new OfficialMcpServer({
      name: config.name,
      version: config.version,
    })
    this.app = express()

    // Parse JSON bodies
    this.app.use(express.json())

    // Enable CORS by default
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'mcp-protocol-version', 'mcp-session-id', 'X-Proxy-Token', 'X-Target-URL'],
    }))

    // Request logging middleware
    this.app.use(requestLogger)

    // Setup default widget serving routes
    this.setupWidgetRoutes()

    // Proxy all Express methods to the underlying app
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) {
          return (target as any)[prop]
        }
        const value = (target.app as any)[prop]
        return typeof value === 'function' ? value.bind(target.app) : value
      }
    }) as McpServer
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
      },
      async () => {
        return await resourceDefinition.readCallback()
      },
    )
    return this
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
  resourceTemplate(resourceTemplateDefinition: ResourceTemplateDefinition): this {
    // Create ResourceTemplate instance from SDK
    const template = new ResourceTemplate(
      resourceTemplateDefinition.resourceTemplate.uriTemplate,
      {
        list: undefined, // Optional: callback to list all matching resources
        complete: undefined // Optional: callback for auto-completion
      }
    )

    // Create metadata object with optional fields
    const metadata: any = {}
    if (resourceTemplateDefinition.resourceTemplate.name) {
      metadata.name = resourceTemplateDefinition.resourceTemplate.name
    }
    if (resourceTemplateDefinition.title) {
      metadata.title = resourceTemplateDefinition.title
    }
    if (resourceTemplateDefinition.description || resourceTemplateDefinition.resourceTemplate.description) {
      metadata.description = resourceTemplateDefinition.description || resourceTemplateDefinition.resourceTemplate.description
    }
    if (resourceTemplateDefinition.resourceTemplate.mimeType) {
      metadata.mimeType = resourceTemplateDefinition.resourceTemplate.mimeType
    }
    if (resourceTemplateDefinition.annotations) {
      metadata.annotations = resourceTemplateDefinition.annotations
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
        )
        return await resourceTemplateDefinition.readCallback(uri, params)
      },
    )
    return this
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
    const inputSchema = this.createToolInputSchema(toolDefinition.inputs || [])

    this.server.registerTool(
      toolDefinition.name,
      {
        title: toolDefinition.title,
        description: toolDefinition.description ?? "",
        inputSchema,
        annotations: toolDefinition.annotations,
        _meta: toolDefinition._meta
      },
      async (params: any) => {
        return await toolDefinition.cb(params)
      },
    )
    return this
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
    const argsSchema = this.createPromptArgsSchema(promptDefinition.args || [])
    this.server.registerPrompt(
      promptDefinition.name,
      {
        title: promptDefinition.title,
        description: promptDefinition.description ?? "",
        argsSchema,
      },
      async (params: any): Promise<GetPromptResult> => {
        return await promptDefinition.cb(params)
      },
    )
    return this
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
   * @param definition - Configuration for the UI widget
   * @param definition.name - Unique identifier for the resource
   * @param definition.type - Type of UI resource (externalUrl, rawHtml, remoteDom, appsSdk)
   * @param definition.title - Human-readable title for the widget
   * @param definition.description - Description of the widget's functionality
   * @param definition.props - Widget properties configuration with types and defaults
   * @param definition.size - Preferred iframe size [width, height] (e.g., ['800px', '600px'])
   * @param definition.annotations - Resource annotations for discovery
   * @param definition.appsSdkMetadata - Apps SDK specific metadata (CSP, widget description, etc.)
   * @returns The server instance for method chaining
   *
   * @example
   * ```typescript
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
    // Determine tool name based on resource type
    // For Apps SDK, use the name directly without ui_ prefix
    let toolName: string
    if (definition.type === 'appsSdk') {
      toolName = definition.name
    } else if (definition.type === 'externalUrl') {
      toolName = `ui_${definition.widget}`
    } else {
      toolName = `ui_${definition.name}`
    }
    const displayName = definition.title || definition.name

    // Determine resource URI and mimeType based on type
    let resourceUri: string
    let mimeType: string

    switch (definition.type) {
      case 'externalUrl':
        resourceUri = `ui://widget/${definition.widget}`
        mimeType = 'text/uri-list'
        break
      case 'rawHtml':
        resourceUri = `ui://widget/${definition.name}`
        mimeType = 'text/html'
        break
      case 'remoteDom':
        resourceUri = `ui://widget/${definition.name}`
        mimeType = 'application/vnd.mcp-ui.remote-dom+javascript'
        break
      case 'appsSdk':
        resourceUri = `ui://widget/${definition.name}.html`
        mimeType = 'text/html+skybridge'
        break
      default:
        throw new Error(`Unsupported UI resource type. Must be one of: externalUrl, rawHtml, remoteDom, appsSdk`)
    }

    // Register the resource
    this.resource({
      name: definition.name,
      uri: resourceUri,
      title: definition.title,
      description: definition.description,
      mimeType,
      annotations: definition.annotations,
      readCallback: async () => {
        // For externalUrl type, use default props. For others, use empty params
        const params = definition.type === 'externalUrl'
          ? this.applyDefaultProps(definition.props)
          : {}

        const uiResource = this.createWidgetUIResource(definition, params)

        return {
          contents: [uiResource.resource]
        }
      }
    })

    // Register the tool - returns UIResource with parameters
    // For Apps SDK, include the outputTemplate metadata
    const toolMetadata: Record<string, unknown> = {}

    if (definition.type === 'appsSdk' && definition.appsSdkMetadata) {
      // Add Apps SDK tool metadata
      toolMetadata['openai/outputTemplate'] = resourceUri

      // Copy over tool-relevant metadata fields from appsSdkMetadata
      const toolMetadataFields = [
        'openai/toolInvocation/invoking',
        'openai/toolInvocation/invoked',
        'openai/widgetAccessible',
        'openai/resultCanProduceWidget'
      ] as const

      for (const field of toolMetadataFields) {
        if (definition.appsSdkMetadata[field] !== undefined) {
          toolMetadata[field] = definition.appsSdkMetadata[field]
        }
      }
    }

    this.tool({
      name: toolName,
      title: definition.title,
      // For Apps SDK, use title as description to match OpenAI's pizzaz reference implementation
      description: definition.type === 'appsSdk' && definition.title
        ? definition.title
        : (definition.description || `Display ${displayName}`),
      inputs: this.convertPropsToInputs(definition.props),
      _meta: Object.keys(toolMetadata).length > 0 ? toolMetadata : undefined,
      cb: async (params) => {
        // Create the UIResource with user-provided params
        const uiResource = this.createWidgetUIResource(definition, params)

        // For Apps SDK, return _meta at top level with only text in content
        if (definition.type === 'appsSdk') {
          return {
            _meta: toolMetadata,
            content: [
              {
                type: 'text',
                text: `Displaying ${displayName}`
              }
            ],
            // structuredContent will be injected as window.openai.toolOutput by Apps SDK
            structuredContent: params
          }
        }

        // For other types, return standard response
        return {
          content: [
            {
              type: 'text',
              text: `Displaying ${displayName}`,
              description: `Show MCP-UI widget for ${displayName}`
            },
            uiResource
          ]
        }
      }
    })

    return this
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
    const urlConfig: UrlConfig = {
      baseUrl: 'http://localhost',
      port: this.serverPort || 3001
    }

    return createUIResourceFromDefinition(definition, params, urlConfig)
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
    const baseUrl = `http://localhost:${this.serverPort}/mcp-use/widgets/${widget}`

    if (Object.keys(params).length === 0) {
      return baseUrl
    }

    const queryParams = new URLSearchParams()

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        if (typeof value === 'object') {
          queryParams.append(key, JSON.stringify(value))
        } else {
          queryParams.append(key, String(value))
        }
      }
    }

    return `${baseUrl}?${queryParams.toString()}`
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
    if (!props) return []

    return Object.entries(props).map(([name, prop]) => ({
      name,
      type: prop.type,
      description: prop.description,
      required: prop.required,
      default: prop.default
    }))
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
    if (!props) return {}

    const defaults: Record<string, any> = {}
    for (const [key, prop] of Object.entries(props)) {
      if (prop.default !== undefined) {
        defaults[key] = prop.default
      }
    }
    return defaults
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
    if (this.mcpMounted) return

    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js')

    const endpoint = '/mcp'

    // POST endpoint for messages
    // Create a new transport for each request to support multiple concurrent clients
    this.app.post(endpoint, express.json(), async (req, res) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      })

      res.on('close', () => {
        transport.close()
      })

      await this.server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    })

    // GET endpoint for SSE streaming
    this.app.get(endpoint, async (req, res) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      })

      res.on('close', () => {
        transport.close()
      })

      await this.server.connect(transport)
      await transport.handleRequest(req, res)
    })

    // DELETE endpoint for session cleanup
    this.app.delete(endpoint, async (req, res) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      })

      res.on('close', () => {
        transport.close()
      })

      await this.server.connect(transport)
      await transport.handleRequest(req, res)
    })

    this.mcpMounted = true
    console.log(`[MCP] Server mounted at ${endpoint}`)
  }

  /**
   * Start the Express server with MCP endpoints
   *
   * Initiates the server startup process by mounting MCP endpoints, configuring
   * the inspector UI (if available), and starting the Express server to listen
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
   * // Server now running at http://localhost:8080
   * // MCP endpoints: http://localhost:8080/mcp
   * // Inspector UI: http://localhost:8080/inspector
   * ```
   */
  async listen(port?: number): Promise<void> {
    await this.mountMcp()
    this.serverPort = port || 3001

    // Mount inspector after we know the port
    this.mountInspector()

    this.app.listen(this.serverPort, () => {
      console.log(`[SERVER] Listening on http://localhost:${this.serverPort}`)
      console.log(`[MCP] Endpoints: http://localhost:${this.serverPort}/mcp`)
    })
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
  private mountInspector(): void {
    if (this.inspectorMounted) return

    // Try to dynamically import the inspector package
    // Using dynamic import makes it truly optional - won't fail if not installed

    // @ts-ignore - Optional peer dependency, may not be installed during build
    import('@mcp-use/inspector')
      .then(({ mountInspector }) => {
        // Auto-connect to the local MCP server at /mcp
        mountInspector(this.app)
        this.inspectorMounted = true
        console.log(`[INSPECTOR] UI available at http://localhost:${this.serverPort}/inspector`)
      })
      .catch(() => {
        // Inspector package not installed, skip mounting silently
        // This allows the server to work without the inspector in production
      })
  }

  /**
   * Setup default widget serving routes
   *
   * Configures Express routes to serve MCP UI widgets and their static assets.
   * Widgets are served from the dist/resources/mcp-use/widgets directory and can
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
    this.app.get('/mcp-use/widgets/:widget/assets/*', (req, res, next) => {
      const widget = req.params.widget
      const assetFile = (req.params as any)[0]
      const assetPath = join(process.cwd(), 'dist', 'resources', 'mcp-use', 'widgets', widget, 'assets', assetFile)
      res.sendFile(assetPath, err => (err ? next() : undefined))
    })

    // Handle assets served from the wrong path (browser resolves ./assets/ relative to /mcp-use/widgets/)
    this.app.get('/mcp-use/widgets/assets/*', (req, res, next) => {
      const assetFile = (req.params as any)[0]
      // Try to find which widget this asset belongs to by checking all widget directories
      const widgetsDir = join(process.cwd(), 'dist', 'resources', 'mcp-use', 'widgets')

      try {
        const widgets = readdirSync(widgetsDir)
        for (const widget of widgets) {
          const assetPath = join(widgetsDir, widget, 'assets', assetFile)
          if (existsSync(assetPath)) {
            return res.sendFile(assetPath)
          }
        }
        next()
      }
      catch {
        next()
      }
    })

    // Serve each widget's index.html at its route
    // e.g. GET /mcp-use/widgets/kanban-board -> dist/resources/mcp-use/widgets/kanban-board/index.html
    this.app.get('/mcp-use/widgets/:widget', (req, res, next) => {
      const filePath = join(process.cwd(), 'dist', 'resources', 'mcp-use', 'widgets', req.params.widget, 'index.html')
      res.sendFile(filePath, err => (err ? next() : undefined))
    })
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
    const params = this.extractTemplateParams(uriTemplate)
    const schema: Record<string, z.ZodSchema> = {}

    params.forEach((param) => {
      schema[param] = z.string()
    })

    return schema
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
   * const schema = this.createToolInputSchema([
   *   { name: 'query', type: 'string', required: true },
   *   { name: 'limit', type: 'number', required: false }
   * ])
   * // Returns: { query: z.string(), limit: z.number().optional() }
   * ```
   */
  private createToolInputSchema(inputs: Array<{ name: string, type: string, required?: boolean, description?: string }>): Record<string, z.ZodSchema> {
    const schema: Record<string, z.ZodSchema> = {}

    inputs.forEach((input) => {
      let zodType: z.ZodSchema
      switch (input.type) {
        case 'string':
          zodType = z.string()
          break
        case 'number':
          zodType = z.number()
          break
        case 'boolean':
          zodType = z.boolean()
          break
        case 'object':
          zodType = z.object({})
          break
        case 'array':
          zodType = z.array(z.any())
          break
        default:
          zodType = z.any()
      }

      // Add description if provided
      if (input.description) {
        zodType = zodType.describe(input.description)
      }

      if (!input.required) {
        zodType = zodType.optional()
      }

      schema[input.name] = zodType
    })

    return schema
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
  private createPromptArgsSchema(inputs: Array<{ name: string, type: string, required?: boolean }>): Record<string, z.ZodSchema> {
    const schema: Record<string, z.ZodSchema> = {}

    inputs.forEach((input) => {
      let zodType: z.ZodSchema
      switch (input.type) {
        case 'string':
          zodType = z.string()
          break
        case 'number':
          zodType = z.number()
          break
        case 'boolean':
          zodType = z.boolean()
          break
        case 'object':
          zodType = z.object({})
          break
        case 'array':
          zodType = z.array(z.any())
          break
        default:
          zodType = z.any()
      }

      if (!input.required) {
        zodType = zodType.optional()
      }

      schema[input.name] = zodType
    })

    return schema
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
    const matches = uriTemplate.match(/\{([^}]+)\}/g)
    return matches ? matches.map(match => match.slice(1, -1)) : []
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
  private parseTemplateUri(template: string, uri: string): Record<string, string> {
    const params: Record<string, string> = {}

    // Convert template to a regex pattern
    // Escape special regex characters except {}
    let regexPattern = template.replace(/[.*+?^$()[\]\\|]/g, '\\$&')

    // Replace {param} with named capture groups
    const paramNames: string[] = []
    regexPattern = regexPattern.replace(/\\\{([^}]+)\\\}/g, (_, paramName) => {
      paramNames.push(paramName)
      return '([^/]+)'
    })

    const regex = new RegExp(`^${regexPattern}$`)
    const match = uri.match(regex)

    if (match) {
      paramNames.forEach((paramName, index) => {
        params[paramName] = match[index + 1]
      })
    }

    return params
  }
}

export type McpServerInstance = Omit<McpServer, keyof Express> & Express

/**
 * Create a new MCP server instance
 */
export function createMCPServer(name: string, config: Partial<ServerConfig> = {}): McpServerInstance {
  const instance = new McpServer({
    name,
    version: config.version || '1.0.0',
    description: config.description,
  })
  return instance as unknown as McpServerInstance
}
