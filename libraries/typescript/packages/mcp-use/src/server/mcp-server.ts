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
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { requestLogger } from './logging.js'
import { createUIResourceFromDefinition, type UrlConfig } from './adapters/mcp-ui-adapter.js'
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js'
import {createServer} from "vite"


const TMP_MCP_USE_DIR = join(process.cwd(), '.mcp-use')


export class McpServer {
  private server: OfficialMcpServer
  private config: ServerConfig
  private app: Express
  private mcpMounted = false
  private inspectorMounted = false
  private serverPort?: number
  private serverHost: string
  private serverBaseUrl?: string

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
    this.serverHost = config.host || 'localhost'
    this.serverBaseUrl = config.baseUrl;
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
        _meta: resourceDefinition._meta,
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
    const inputSchema = this.createParamsSchema(toolDefinition.inputs || [])

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
    const argsSchema = this.createParamsSchema(promptDefinition.args || [])
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
   * Register an Apps SDK compatible UI widget as both a tool and a resource
   *
   * This method automatically converts a widget from the resources directory into an
   * Apps SDK compatible format by inlining all HTML, CSS, and JavaScript into a single
   * htmlTemplate. It reads the built widget files and creates a text/html+skybridge
   * resource that works with OpenAI's Apps SDK.
   *
   * @param widgetName - Widget name to load from the manifest
   * @param options - Optional Apps SDK metadata configuration
   * @param options.appsSdkMetadata - Apps SDK specific metadata (CSP, widget description, etc.)
   * @param options.title - Override the auto-generated title
   * @param options.description - Override the description from manifest
   * @param options.size - Preferred widget size [width, height] (e.g., ['800px', '600px'])
   * @returns The server instance for method chaining
   *
   * @example
   * ```typescript
   * // Simple usage - auto-loads from generated schema
   * server.appsUiResource('display-weather')
   * 
   * // With custom metadata
   * server.appsUiResource('display-weather', {
   *   appsSdkMetadata: {
   *     'openai/widgetDescription': 'Interactive weather display widget',
   *     'openai/toolInvocation/invoking': 'Fetching weather data...',
   *     'openai/toolInvocation/invoked': 'Weather displayed',
   *     'openai/widgetAccessible': true,
   *     'openai/resultCanProduceWidget': true,
   *     'openai/widgetCSP': {
   *       connect_domains: ['https://chatgpt.com'],
   *       resource_domains: ['https://*.oaistatic.com']
   *       // Note: If MCP_URL/baseUrl is set, it will be automatically added to resource_domains
   *     }
   *   }
   * })
   * ```
   */
  appsUiResource(
    widgetName: string, 
    options?: {
      appsSdkMetadata?: Record<string, any>,
      title?: string,
      description?: string,
      size?: [string, string]
    }
  ): this {
    // Load widget schema from manifest
    const schema :any= {}
    
    // Read the built widget's HTML file to extract asset references
    const widgetHtmlPath = join(process.cwd(), 'dist/resources/mcp-use/widgets', widgetName, 'index.html')
    
    try {
      const htmlContent = readFileSync(widgetHtmlPath, 'utf8')
      
      // Extract the script src from the HTML
      const scriptMatch = htmlContent.match(/<script type="module" src="\.\/assets\/([^"]+)"/)
      if (!scriptMatch) {
        throw new Error(`Could not find script tag in ${widgetName}/index.html`)
      }
      
      const scriptFile = scriptMatch[1]
      
      // Extract the styles from the HTML
      const styleMatch = htmlContent.match(/<style>([\s\S]*?)<\/style>/)
      const styles = styleMatch ? styleMatch[1] : ''
      
      // Store the template data for runtime generation
      const templateData = {
        widgetName,
        scriptFile,
        styles,
        title: schema.title || widgetName
      }
      
      // Create a function that generates the HTML template at runtime with the correct port
      const generateHtmlTemplate = () => {
        // Use baseUrl if provided, otherwise construct from host:port
        const baseUrl = this.serverBaseUrl || `http://${this.serverHost}:${this.serverPort || 3001}`
        const scriptUrl = `${baseUrl}/mcp-use/widgets/${widgetName}/assets/${scriptFile}`
        
        return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${templateData.title}</title>
    <style>${styles}</style>
  </head>
  <body>
    <div id="widget-root"></div>
    <script type="module" src="${scriptUrl}"></script>
  </body>
</html>
        `.trim()
      }
      
      // For Apps SDK, we need to use rawHtml type with dynamic template generation
      // We'll create a custom UIResourceDefinition that generates HTML at request time
      
      // Prepare Apps SDK metadata with automatic CSP configuration
      const appsSdkMetadata = options?.appsSdkMetadata || {}
      
      // Automatically add the base URL domain to CSP resource_domains if baseUrl is set
      if (this.serverBaseUrl) {
        try {
          const url = new URL(this.serverBaseUrl)
          const domain = `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`
          
          // Initialize CSP if not present
          if (!appsSdkMetadata['openai/widgetCSP']) {
            appsSdkMetadata['openai/widgetCSP'] = {
              connect_domains: [],
              resource_domains: []
            }
          }
          
          // Ensure resource_domains exists and add the domain if not already present
          const csp = appsSdkMetadata['openai/widgetCSP'] as any
          if (!csp.resource_domains) {
            csp.resource_domains = []
          }
          if (!csp.resource_domains.includes(domain)) {
            csp.resource_domains.push(domain)
            console.log(`[Apps SDK] Added ${domain} to CSP resource_domains for widget "${widgetName}"`)
          }
        } catch (e) {
          console.warn('Failed to parse baseUrl for CSP configuration', e)
        }
      }
      
      const definition: UIResourceDefinition = {
        type: 'rawHtml',
        name: widgetName,
        title: options?.title || schema.title,
        description: options?.description || schema.description,
        props: schema.props,
        htmlContent: '', // Placeholder, will be replaced
        size: options?.size,
        appsSdkMetadata
      }
      
      // Override the resource registration to generate HTML at runtime
      const resourceUri = `ui://widget/${widgetName}.html`
      const mimeType = 'text/html+skybridge'
      
      // Register the resource with dynamic HTML generation
      this.resource({
        name: widgetName,
        uri: resourceUri,
        title: definition.title,
        description: definition.description,
        mimeType,
        annotations: definition.annotations,
        _meta: definition._meta,
        readCallback: async () => {
          const htmlTemplate = generateHtmlTemplate()
          const resource: any = {
            uri: resourceUri,
            mimeType,
            text: htmlTemplate
          }
          
          // Add metadata if provided
          if (definition.appsSdkMetadata && Object.keys(definition.appsSdkMetadata).length > 0) {
            resource._meta = definition.appsSdkMetadata
          }
          
          return {
            contents: [resource]
          }
        }
      })
      
      // Register the resource template for dynamic URIs
      this.resourceTemplate({
        name: `${widgetName}-dynamic`,
        resourceTemplate: {
          uriTemplate: `ui://widget/${widgetName}-{id}.html`,
          name: definition.title || widgetName,
          description: definition.description,
          mimeType
        },
        _meta: definition._meta,
        title: definition.title,
        description: definition.description,
        annotations: definition.annotations,
        readCallback: async (uri, params) => {
          const htmlTemplate = generateHtmlTemplate()
          const resource: any = {
            uri: uri.toString(),
            mimeType,
            text: htmlTemplate
          }
          
          if (definition.appsSdkMetadata && Object.keys(definition.appsSdkMetadata).length > 0) {
            resource._meta = definition.appsSdkMetadata
          }
          
          return {
            contents: [resource]
          }
        }
      })
      
      // Register the tool
      const toolName = widgetName
      const displayName = definition.title || widgetName
      const toolMetadata: Record<string, unknown> = {
        'openai/outputTemplate': resourceUri
      }
      
      // Copy over tool-relevant metadata fields from appsSdkMetadata
      if (definition.appsSdkMetadata) {
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
        description: definition.title || definition.description || `Display ${displayName}`,
        inputs: this.convertPropsToInputs(definition.props),
        _meta: Object.keys(toolMetadata).length > 0 ? toolMetadata : undefined,
        cb: async (params) => {
          // Generate a unique URI with random ID for each invocation
          const randomId = Math.random().toString(36).substring(2, 15)
          const uniqueUri = `ui://widget/${widgetName}-${randomId}.html`
          
          // Update toolMetadata with the unique URI
          const uniqueToolMetadata = { ...toolMetadata, 'openai/outputTemplate': uniqueUri }
          
          return {
            _meta: uniqueToolMetadata,
            content: [
              {
                type: 'text',
                text: `Displaying ${displayName}`
              }
            ],
            structuredContent: params
          }
        }
      })
      
      return this
    } catch (error) {
      throw new Error(
        `Failed to load widget files for "${widgetName}". ` +
        `Make sure to run the build process to generate the widget files. ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      )
    }
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
      _meta: definition._meta,
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

    // For Apps SDK, also register a resource template to handle dynamic URIs with random IDs
    if (definition.type === 'appsSdk') {
      this.resourceTemplate({
        name: `${definition.name}-dynamic`,
        resourceTemplate: {
          uriTemplate: `ui://widget/${definition.name}-{id}.html`,
          name: definition.title || definition.name,
          description: definition.description,
          mimeType
        },
        _meta: definition._meta,
        title: definition.title,
        description: definition.description,
        annotations: definition.annotations,
        readCallback: async (uri, params) => {
          // Use empty params for Apps SDK since structuredContent is passed separately
          const uiResource = this.createWidgetUIResource(definition, {})
          
          return {
            contents: [uiResource.resource]
          }
        }
      })
    }

    // Register the tool - returns UIResource with parameters
    // For Apps SDK, include the outputTemplate metadata
    const toolMetadata: Record<string, unknown> = definition._meta || {}

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
      name: definition.name,
      title: definition.title,
      description: definition.description,
      inputs: this.convertPropsToInputs(definition.props),
      _meta: Object.keys(toolMetadata).length > 0 ? toolMetadata : undefined,
      cb: async (params) => {
        // Create the UIResource with user-provided params
        const uiResource = this.createWidgetUIResource(definition, params)

        // For Apps SDK, return _meta at top level with only text in content
        if (definition.type === 'appsSdk') {
          // Generate a unique URI with random ID for each invocation
          const randomId = Math.random().toString(36).substring(2, 15)
          const uniqueUri = `ui://widget/${definition.name}-${randomId}.html`
          
          // Update toolMetadata with the unique URI
          const uniqueToolMetadata = { ...toolMetadata, 'openai/outputTemplate': uniqueUri }
          
          return {
            _meta: uniqueToolMetadata,
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
    // If baseUrl is set, parse it to extract protocol, host, and port
    let configBaseUrl = `http://${this.serverHost}`
    let configPort: number | string = this.serverPort || 3001
    
    if (this.serverBaseUrl) {
      try {
        const url = new URL(this.serverBaseUrl)
        configBaseUrl = `${url.protocol}//${url.hostname}`
        configPort = url.port || (url.protocol === 'https:' ? 443 : 80)
      } catch (e) {
        // Fall back to host:port if baseUrl parsing fails
        console.warn('Failed to parse baseUrl, falling back to host:port', e)
      }
    }
    
    const urlConfig: UrlConfig = {
      baseUrl: configBaseUrl,
      port: configPort
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
    const baseUrl = `http://${this.serverHost}:${this.serverPort}/mcp-use/widgets/${widget}`

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
   * Mount individual widget files from resources/ directory
   *
   * Scans the resources/ directory for .tsx/.ts widget files and creates individual
   * Vite dev servers for each widget with HMR support. Each widget is served at its
   * own route: /mcp-use/widgets/{widget-name}
   *
   * @param options - Configuration options
   * @param options.baseRoute - Base route for widgets (defaults to '/mcp-use/widgets')
   * @param options.resourcesDir - Directory containing widget files (defaults to 'resources')
   * @returns Promise that resolves when all widgets are mounted
   *
   * @example
   * ```typescript
   * // Serve all widgets from resources/ at /mcp-use/widgets/{name}
   * await server.mountWidgets({
   *   baseRoute: '/mcp-use/widgets',
   *   resourcesDir: 'resources'
   * })
   * // Now accessible at:
   * // - /mcp-use/widgets/display-weather
   * // - /mcp-use/widgets/kanban-board
   * // etc.
   * ```
   */
  async mountWidgets(options?: {
    baseRoute?: string
    resourcesDir?: string
  }): Promise<void> {
    const { promises: fs } = await import('node:fs')
    const baseRoute = options?.baseRoute || '/mcp-use/widgets'
    const resourcesDir = options?.resourcesDir || 'resources'
    const srcDir = join(process.cwd(), resourcesDir)
    
    // Check if resources directory exists
    try {
      await fs.access(srcDir)
    } catch (error) {
      console.log(`[WIDGETS] No ${resourcesDir}/ directory found - skipping widget serving`)
      return
    }
    
    // Find all TSX widget files
    let entries: string[] = []
    try {
      const files = await fs.readdir(srcDir)
      entries = files
        .filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))
        .map(f => join(srcDir, f))
    } catch (error) {
      console.log(`[WIDGETS] No widgets found in ${resourcesDir}/ directory`)
      return
    }
    
    if (entries.length === 0) {
      console.log(`[WIDGETS] No widgets found in ${resourcesDir}/ directory`)
      return
    }
    
    // Create a temp directory for widget entry files
    const tempDir = join(process.cwd(), TMP_MCP_USE_DIR)
    await fs.mkdir(tempDir, { recursive: true }).catch(() => {})
    
    const react = (await import('@vitejs/plugin-react')).default
    const tailwindcss = (await import('@tailwindcss/vite')).default
    console.log(react, tailwindcss)


    const widgets = entries.map(entry => {
      const baseName = entry.split('/').pop()?.replace(/\.tsx?$/, '') || 'widget'
      const widgetName = baseName
      return {
        name: widgetName,
        description: `Widget: ${widgetName}`,
        entry: entry
      }
    })
    
    // Create entry files for each widget
    for (const widget of widgets) {
      // Create temp entry and HTML files for this widget
      const widgetTempDir = join(tempDir, widget.name)
      await fs.mkdir(widgetTempDir, { recursive: true })
      
      // Create a CSS file with Tailwind and @source directives to scan resources
      const resourcesPath = join(process.cwd(), resourcesDir)
      const { relative } = await import('node:path')
      const relativeResourcesPath = relative(widgetTempDir, resourcesPath).replace(/\\/g, '/')
      const cssContent = `@import "tailwindcss";

/* Configure Tailwind to scan the resources directory */
@source "${relativeResourcesPath}";
`
      await fs.writeFile(join(widgetTempDir, 'styles.css'), cssContent, 'utf8')
      
      const entryContent = `import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import Component from '${widget.entry}'

const container = document.getElementById('widget-root')
if (container && Component) {
  const root = createRoot(container)
  root.render(<Component />)
}
`
      
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
</html>`
      
      await fs.writeFile(join(widgetTempDir, 'entry.tsx'), entryContent, 'utf8')
      await fs.writeFile(join(widgetTempDir, 'index.html'), htmlContent, 'utf8')
    }
    
    // Create a single Vite dev server for all widgets
    const viteServer = await createServer({
      root: tempDir,
      base: baseRoute + '/',
      plugins: [tailwindcss(), react()],
      resolve: {
        alias: {
          '@': join(process.cwd(), resourcesDir),
        },
      },
      server: {
        middlewareMode: true,
      },
    })
    
    // Custom middleware to route to the correct widget
    this.app.use(baseRoute, (req, res, next) => {
      const urlPath = req.url || ''
      const widgetMatch = urlPath.match(/^\/([^/]+)/)
      
      if (widgetMatch) {
        const widgetName = widgetMatch[1]
        const widget = widgets.find(w => w.name === widgetName)
        
        if (widget) {
          // Rewrite the URL to point to the widget's directory
          req.url = urlPath.replace(`/${widgetName}`, `/${widgetName}`)
          
          // If requesting the root of a widget, serve its index.html
          if (urlPath === `/${widgetName}` || urlPath === `/${widgetName}/`) {
            req.url = `/${widgetName}/index.html`
          }
        }
      }
      
      next()
    })
    
    // Mount the single Vite server for all widgets
    this.app.use(baseRoute, viteServer.middlewares)
    
    console.log(`[WIDGETS] Serving ${entries.length} widget(s) with shared Vite server and HMR`)
    widgets.forEach(widget => {
      console.log(`[WIDGET] ${widget.name} mounted at ${baseRoute}/${widget.name}`)
    })



    // register a tool and resource for each widget
    for (const widget of widgets) {

      // for now expose all widgets as appsSdk
      const type = 'appsSdk'
      
      const props = {}

      let html = '';
      try {
        html = await readFileSync(join(tempDir, widget.name, 'index.html'), 'utf8')
      } catch (error) {
        console.error(`Failed to read html template for widget ${widget.name}`, error)
      }

      // // html template is the content of the vite built html
      // const html = await fetch(`${this.serverBaseUrl}/mcp-use/widgets/${widget.name}/index.html`).then(res => res.text())
      // if (!html) {
      //   throw new Error(`Failed to fetch html template for widget ${widget.name}`)
      // }

      this.uiResource({
        name: widget.name,
        title: widget.name,
        description: widget.description,
        type: type,
        props: props,
        _meta: {
          'mcp-use/widget': {
            name: widget.name,
            description: widget.description,
            type: type,
            props: props,
            html: html
          }
        },
        htmlTemplate: html,
        appsSdkMetadata: {
          'openai/widgetDescription': widget.description,
          'openai/toolInvocation/invoking': 'Hand-tossing a map',
          'openai/toolInvocation/invoked': 'Served a fresh map',
          'openai/widgetAccessible': true,
          'openai/resultCanProduceWidget': true,
          'openai/widgetCSP': {
            connect_domains: [],
            resource_domains: ['https://persistent.oaistatic.com']
          }
        }
      })
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
   * @param port - Port number to listen on (defaults to PORT env var or 3001 if not specified)
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
    this.serverPort = port || (process.env.PORT ? parseInt(process.env.PORT, 10) : 3001)
    
    // Update host from HOST env var if set
    if (process.env.HOST) {
      this.serverHost = process.env.HOST
    }

    await this.mountWidgets({
      baseRoute: '/mcp-use/widgets',
      resourcesDir: 'resources'
    })
    await this.mountMcp()
    

    // Mount inspector BEFORE Vite middleware to ensure it handles /inspector routes
    this.mountInspector()

    this.app.listen(this.serverPort, () => {
      console.log(`[SERVER] Listening on http://${this.serverHost}:${this.serverPort}`)
      console.log(`[MCP] Endpoints: http://${this.serverHost}:${this.serverPort}/mcp`)
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
        console.log(`[INSPECTOR] UI available at http://${this.serverHost}:${this.serverPort}/inspector`)
      })
      .catch(() => {
        // Inspector package not installed, skip mounting silently
        // This allows the server to work without the inspector in production
      })
  }



  /**
   * Create schema for tool inputs or prompt arguments
   *
   * Converts input/argument definitions into Zod validation schemas for runtime validation.
   * Supports common data types (string, number, boolean, object, array), optional
   * parameters, and descriptions. Used internally when registering tools and prompts with the MCP server.
   *
   * @param inputs - Array of input parameter definitions with name, type, optional flag, and description
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
  private createParamsSchema(inputs: Array<{ name: string, type: string, required?: boolean, description?: string }>): Record<string, z.ZodSchema> {
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
 * 
 * @param name - Server name
   * @param config - Optional server configuration
   * @param config.version - Server version (defaults to '1.0.0')
   * @param config.description - Server description
   * @param config.host - Hostname for widget URLs and server endpoints (defaults to 'localhost')
   * @param config.baseUrl - Full base URL (e.g., 'https://myserver.com') - overrides host:port for widget URLs
   * @returns McpServerInstance with both MCP and Express methods
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
export function createMCPServer(name: string, config: Partial<ServerConfig> = {}): McpServerInstance {
  const instance = new McpServer({
    name,
    version: config.version || '1.0.0',
    description: config.description,
    host: config.host,
    baseUrl: config.baseUrl,
  })
  return instance as unknown as McpServerInstance
}
