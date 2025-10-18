import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import type { ResourceAnnotations } from './common.js'
import type { AdaptersConfig } from '@mcp-ui/server'

// UIResourceContent type from MCP-UI
export type UIResourceContent = {
  type: 'resource'
  resource: {
    uri: string
    mimeType: string
    _meta?: AppsSdkMetadata
  } & (
    | { text: string; blob?: never }
    | { blob: string; text?: never }
  )
}

/**
 * Apps SDK resource metadata fields
 * 
 * These fields are set on the resource itself (in resource._meta).
 * They control how the widget is rendered and secured.
 * 
 * @note Resource-level metadata for Apps SDK widgets
 * @see https://developers.openai.com/apps-sdk/build/mcp-server
 */
export interface AppsSdkMetadata extends Record<string, unknown> {
  /** Description of the widget for Apps SDK - helps the model understand what's displayed */
  'openai/widgetDescription'?: string

  /** Content Security Policy for the widget */
  'openai/widgetCSP'?: {
    /** Domains the widget can connect to (for fetch, websocket, etc.) */
    connect_domains?: string[]
    /** Domains the widget can load resources from (scripts, styles, images, fonts) */
    resource_domains?: string[]
  }

  /** Whether the widget prefers a border in card layout */
  'openai/widgetPrefersBorder'?: boolean

  /** Whether the widget can initiate tool calls (component-initiated tool access) */
  'openai/widgetAccessible'?: boolean

  /** Custom subdomain for the widget (e.g., 'chatgpt.com' becomes 'chatgpt-com.web-sandbox.oaiusercontent.com') */
  'openai/widgetDomain'?: string

  /** Locale for the widget (e.g., 'en-US', 'fr-FR') */
  'openai/locale'?: string

  /** Status text while tool is invoking */
  'openai/toolInvocation/invoking'?: string

  /** Status text after tool has invoked */
  'openai/toolInvocation/invoked'?: string
}

/**
 * Apps SDK tool metadata fields
 * 
 * These fields are set on the tool itself (in tool._meta).
 * They connect the tool to its widget template and control invocation behavior.
 * 
 * @note Tool-level metadata for Apps SDK integration
 * @see https://developers.openai.com/apps-sdk/build/mcp-server
 */
export interface AppsSdkToolMetadata extends Record<string, unknown> {
  /** URI of the output template resource that will render this tool's output */
  'openai/outputTemplate'?: string

  /** Status text while tool is invoking */
  'openai/toolInvocation/invoking'?: string

  /** Status text after tool has invoked */
  'openai/toolInvocation/invoked'?: string

  /** Whether the widget can initiate tool calls */
  'openai/widgetAccessible'?: boolean

  /** Whether this tool result can produce a widget */
  'openai/resultCanProduceWidget'?: boolean
}

// Handler types
export type ResourceHandler = () => Promise<ReadResourceResult>
export type ResourceTemplateHandler = (uri: URL, params: Record<string, any>) => Promise<ReadResourceResult>

/**
 * Configuration for a resource template
 */
export interface ResourceTemplateConfig {
  /** URI template with {param} placeholders (e.g., "user://{userId}/profile") */
  uriTemplate: string
  /** Name of the resource */
  name?: string
  /** MIME type of the resource content */
  mimeType?: string
  /** Description of the resource */
  description?: string
}

export interface ResourceTemplateDefinition {
  name: string
  resourceTemplate: ResourceTemplateConfig
  title?: string
  description?: string
  annotations?: ResourceAnnotations
  fn: ResourceTemplateHandler
}

export interface ResourceDefinition {
  /** Unique identifier for the resource */
  name: string
  /** URI pattern for accessing the resource (e.g., 'config://app-settings') */
  uri: string
  /** Optional title for the resource */
  title?: string
  /** Optional description of the resource */
  description?: string
  /** MIME type of the resource content (required) */
  mimeType: string
  /** Optional annotations for the resource */
  annotations?: ResourceAnnotations
  /** Async function that returns the resource content */
  fn: ResourceHandler
}

/**
 * UIResource-specific types
 */
export interface WidgetProps {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array'
    required?: boolean
    default?: any
    description?: string
  }
}

/**
 * Encoding options for UI resources
 */
export type UIEncoding = 'text' | 'blob'

/**
 * Framework options for Remote DOM resources
 */
export type RemoteDomFramework = 'react' | 'webcomponents'

/**
 * Base properties shared by all UI resource types
 */
interface BaseUIResourceDefinition {
  /** Unique identifier for the resource */
  name: string
  /** Human-readable title */
  title?: string
  /** Description of what the widget does */
  description?: string
  /** Widget properties/parameters configuration */
  props?: WidgetProps
  /** Preferred frame size [width, height] (e.g., ['800px', '600px']) */
  size?: [string, string]
  /** Resource annotations for discovery and presentation */
  annotations?: ResourceAnnotations
  /** Encoding for the resource content (defaults to 'text') */
  encoding?: UIEncoding
}

/**
 * External URL UI resource - serves widget via iframe (legacy MCP-UI)
 */
export interface ExternalUrlUIResource extends BaseUIResourceDefinition {
  type: 'externalUrl'
  /** Widget identifier (e.g., 'kanban-board', 'chart') */
  widget: string
  /** Adapter configuration */
  adapters?: AdaptersConfig
  /** Apps SDK metadata fields */
  appsSdkMetadata?: AppsSdkMetadata
}

/**
 * Raw HTML UI resource - direct HTML content (legacy MCP-UI)
 */
export interface RawHtmlUIResource extends BaseUIResourceDefinition {
  type: 'rawHtml'
  /** HTML content to render */
  htmlContent: string
  /** Adapter configuration */
  adapters?: AdaptersConfig
  /** Apps SDK metadata fields */
  appsSdkMetadata?: AppsSdkMetadata
}

/**
 * Remote DOM UI resource - scripted UI components (legacy MCP-UI)
 */
export interface RemoteDomUIResource extends BaseUIResourceDefinition {
  type: 'remoteDom'
  /** JavaScript code for remote DOM manipulation */
  script: string
  /** Framework for remote DOM (defaults to 'react') */
  framework?: RemoteDomFramework
  /** Adapter configuration */
  adapters?: AdaptersConfig
  /** Apps SDK metadata fields */
  appsSdkMetadata?: AppsSdkMetadata
}

/**
 * Apps SDK UI resource - OpenAI Apps SDK compatible widget
 * 
 * This type follows the official OpenAI Apps SDK pattern:
 * - Uses text/html+skybridge mime type
 * - Supports component HTML with embedded JS/CSS
 * - Tool returns structuredContent that gets injected as window.openai.toolOutput
 * - Supports CSP, widget domains, and other Apps SDK metadata
 * 
 * @see https://developers.openai.com/apps-sdk/build/mcp-server
 * @see https://mcpui.dev/guide/apps-sdk
 */
export interface AppsSdkUIResource extends BaseUIResourceDefinition {
  type: 'appsSdk'
  /** HTML template content - the component that will be rendered */
  htmlTemplate: string
  /** Apps SDK-specific metadata */
  appsSdkMetadata?: AppsSdkMetadata
}

/**
 * Discriminated union of all UI resource types
 */
export type UIResourceDefinition =
  | ExternalUrlUIResource
  | RawHtmlUIResource
  | RemoteDomUIResource
  | AppsSdkUIResource

export interface WidgetConfig {
  /** Widget directory name */
  name: string
  /** Absolute path to widget directory */
  path: string
  /** Widget manifest if present */
  manifest?: WidgetManifest
  /** Main component file name */
  component?: string
}

export interface WidgetManifest {
  name: string
  title?: string
  description?: string
  version?: string
  props?: WidgetProps
  size?: [string, string]
  assets?: {
    main?: string
    scripts?: string[]
    styles?: string[]
  }
}

export interface DiscoverWidgetsOptions {
  /** Path to widgets directory (defaults to dist/resources/mcp-use/widgets) */
  path?: string
  /** Automatically register widgets without manifests */
  autoRegister?: boolean
  /** Filter widgets by name pattern */
  filter?: string | RegExp
}