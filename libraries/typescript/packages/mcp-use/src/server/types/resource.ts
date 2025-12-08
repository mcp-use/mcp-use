import type {
  ReadResourceResult,
  CallToolResult,
} from "@mcp-use/modelcontextprotocol-sdk/types.js";
import type { ResourceAnnotations } from "./common.js";
import type { ToolAnnotations } from "./tool.js";
import type { AdaptersConfig } from "@mcp-ui/server";
import type { TypedCallToolResult } from "../utils/response-helpers.js";
import type { McpContext } from "./context.js";

// UIResourceContent type from MCP-UI
export type UIResourceContent = {
  type: "resource";
  resource: {
    uri: string;
    mimeType: string;
    _meta?: AppsSdkMetadata;
  } & ({ text: string; blob?: never } | { blob: string; text?: never });
};

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
  "openai/widgetDescription"?: string;

  /** Content Security Policy for the widget */
  "openai/widgetCSP"?: {
    /** Domains the widget can connect to (for fetch, websocket, etc.) */
    connect_domains?: string[];
    /** Domains the widget can load resources from (scripts, styles, images, fonts) */
    resource_domains?: string[];
  };

  /** Whether the widget prefers a border in card layout */
  "openai/widgetPrefersBorder"?: boolean;

  /** Whether the widget can initiate tool calls (component-initiated tool access) */
  "openai/widgetAccessible"?: boolean;

  /** Custom subdomain for the widget (e.g., 'chatgpt.com' becomes 'chatgpt-com.web-sandbox.oaiusercontent.com') */
  "openai/widgetDomain"?: string;

  /** Locale for the widget (e.g., 'en-US', 'fr-FR') */
  "openai/locale"?: string;

  /** Status text while tool is invoking */
  "openai/toolInvocation/invoking"?: string;

  /** Status text after tool has invoked */
  "openai/toolInvocation/invoked"?: string;
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
  "openai/outputTemplate"?: string;

  /** Status text while tool is invoking */
  "openai/toolInvocation/invoking"?: string;

  /** Status text after tool has invoked */
  "openai/toolInvocation/invoked"?: string;

  /** Whether the widget can initiate tool calls */
  "openai/widgetAccessible"?: boolean;

  /** Whether this tool result can produce a widget */
  "openai/resultCanProduceWidget"?: boolean;
}

/**
 * Enhanced Resource Context that provides access to request context.
 *
 * This unified context provides:
 * - `auth` - Authentication info (when OAuth is configured)
 * - `req` - Hono request object
 * - All other Hono Context properties and methods
 *
 * @template HasOAuth - Whether OAuth is configured (affects auth availability)
 */
export type EnhancedResourceContext<HasOAuth extends boolean = false> =
  McpContext<HasOAuth>;

/**
 * Helper interface for bivariant parameter checking on resource callbacks.
 * @internal
 */
interface ReadResourceCallbackBivariant<HasOAuth extends boolean> {
  bivarianceHack(
    ctx: EnhancedResourceContext<HasOAuth>
  ): Promise<CallToolResult | ReadResourceResult | TypedCallToolResult<any>>;
}

/**
 * Callback type for reading a static resource.
 * Supports both CallToolResult (from helpers) and ReadResourceResult (old API).
 *
 * @template HasOAuth - Whether OAuth is configured (affects ctx.auth availability)
 */
export type ReadResourceCallback<HasOAuth extends boolean = false> =
  ReadResourceCallbackBivariant<HasOAuth>["bivarianceHack"];

/**
 * Callback type for reading a resource template with parameters.
 * Supports both CallToolResult (from helpers) and ReadResourceResult (old API).
 *
 * Supports multiple callback signatures:
 * - `async () => ...` - No parameters
 * - `async (uri: URL) => ...` - Just URI (required)
 * - `async (uri: URL, params: Record<string, any>) => ...` - URI and parameters (both required)
 * - `async (uri: URL, params: Record<string, any>, ctx: EnhancedResourceContext) => ...` - All parameters (all required)
 *
 * The implementation checks callback.length to determine which signature to use.
 *
 * @template HasOAuth - Whether OAuth is configured (affects ctx.auth availability)
 */
export type ReadResourceTemplateCallback<HasOAuth extends boolean = false> =
  | (() => Promise<
      CallToolResult | ReadResourceResult | TypedCallToolResult<any>
    >)
  | ((
      uri: URL
    ) => Promise<
      CallToolResult | ReadResourceResult | TypedCallToolResult<any>
    >)
  | ((
      uri: URL,
      params: Record<string, any>
    ) => Promise<
      CallToolResult | ReadResourceResult | TypedCallToolResult<any>
    >)
  | ((
      uri: URL,
      params: Record<string, any>,
      ctx: EnhancedResourceContext<HasOAuth>
    ) => Promise<
      CallToolResult | ReadResourceResult | TypedCallToolResult<any>
    >);

/**
 * Configuration for a resource template
 */
export interface ResourceTemplateConfig {
  /** URI template with {param} placeholders (e.g., "user://{userId}/profile") */
  uriTemplate: string;
  /** Name of the resource */
  name?: string;
  /** MIME type of the resource content */
  mimeType?: string;
  /** Description of the resource */
  description?: string;
}

/**
 * Resource template definition with readCallback (old API)
 */
export interface ResourceTemplateDefinition<HasOAuth extends boolean = false> {
  name: string;
  resourceTemplate: ResourceTemplateConfig;
  title?: string;
  description?: string;
  annotations?: ResourceAnnotations;
  readCallback: ReadResourceTemplateCallback<HasOAuth>;
  _meta?: Record<string, unknown>;
}

/**
 * Resource template definition without readCallback (new API with separate callback parameter)
 */
export interface ResourceTemplateDefinitionWithoutCallback {
  name: string;
  resourceTemplate: ResourceTemplateConfig;
  title?: string;
  description?: string;
  annotations?: ResourceAnnotations;
  _meta?: Record<string, unknown>;
}

/**
 * Flat resource template definition with readCallback (new API)
 *
 * Simplified structure where uriTemplate is directly on the definition object
 * instead of nested in a resourceTemplate property.
 */
export interface FlatResourceTemplateDefinition<
  HasOAuth extends boolean = false,
> {
  /** Unique identifier for the template */
  name: string;
  /** URI template with {param} placeholders (e.g., "user://{userId}/profile") */
  uriTemplate: string;
  /** Optional title for the resource */
  title?: string;
  /** Optional description of the resource */
  description?: string;
  /** MIME type of the resource content */
  mimeType?: string;
  /** Optional annotations for the resource */
  annotations?: ResourceAnnotations;
  /** Async callback function that returns the resource content */
  readCallback: ReadResourceTemplateCallback<HasOAuth>;
  _meta?: Record<string, unknown>;
}

/**
 * Flat resource template definition without readCallback (new API with separate callback parameter)
 *
 * Simplified structure where uriTemplate is directly on the definition object
 * instead of nested in a resourceTemplate property.
 */
export interface FlatResourceTemplateDefinitionWithoutCallback {
  /** Unique identifier for the template */
  name: string;
  /** URI template with {param} placeholders (e.g., "user://{userId}/profile") */
  uriTemplate: string;
  /** Optional title for the resource */
  title?: string;
  /** Optional description of the resource */
  description?: string;
  /** MIME type of the resource content */
  mimeType?: string;
  /** Optional annotations for the resource */
  annotations?: ResourceAnnotations;
  _meta?: Record<string, unknown>;
}

/**
 * Resource definition with readCallback (old API)
 */
export interface ResourceDefinition<HasOAuth extends boolean = false> {
  /** Unique identifier for the resource */
  name: string;
  /** URI pattern for accessing the resource (e.g., 'config://app-settings') */
  uri: string;
  /** Optional title for the resource */
  title?: string;
  /** Optional description of the resource */
  description?: string;
  /** MIME type of the resource content (required for old API) */
  mimeType: string;
  /** Optional annotations for the resource */
  annotations?: ResourceAnnotations;
  /** Async callback function that returns the resource content */
  readCallback: ReadResourceCallback<HasOAuth>;
  _meta?: Record<string, unknown>;
}

/**
 * Resource definition without readCallback (new API with separate callback parameter)
 * MIME type is optional when using response helpers - it's inferred from the helper
 */
export interface ResourceDefinitionWithoutCallback {
  /** Unique identifier for the resource */
  name: string;
  /** URI pattern for accessing the resource (e.g., 'config://app-settings') */
  uri: string;
  /** Optional title for the resource */
  title?: string;
  /** Optional description of the resource */
  description?: string;
  /** MIME type (optional - inferred from response helpers like text(), object(), etc.) */
  mimeType?: string;
  /** Optional annotations for the resource */
  annotations?: ResourceAnnotations;
  _meta?: Record<string, unknown>;
}

/**
 * UIResource-specific types
 */
export interface WidgetProps {
  [key: string]: {
    type: "string" | "number" | "boolean" | "object" | "array";
    required?: boolean;
    default?: unknown;
    description?: string;
  };
}

/**
 * Encoding options for UI resources
 */
export type UIEncoding = "text" | "blob";

/**
 * Framework options for Remote DOM resources
 */
export type RemoteDomFramework = "react" | "webcomponents";

/**
 * Base properties shared by all UI resource types
 */
interface BaseUIResourceDefinition {
  /** Unique identifier for the resource */
  name: string;
  /** Human-readable title */
  title?: string;
  /** Description of what the widget does */
  description?: string;
  /** Widget properties/parameters configuration */
  props?: WidgetProps;
  /** Preferred frame size [width, height] (e.g., ['800px', '600px']) */
  size?: [string, string];
  /** Resource annotations for discovery and presentation */
  annotations?: ResourceAnnotations;
  /** Encoding for the resource content (defaults to 'text') */
  encoding?: UIEncoding;
  /** Control automatic tool registration (defaults to true) */
  exposeAsTool?: boolean;
  /** Tool annotations when registered as a tool */
  toolAnnotations?: ToolAnnotations;

  _meta?: Record<string, unknown>;
}

/**
 * External URL UI resource - serves widget via iframe (legacy MCP-UI)
 */
export interface ExternalUrlUIResource extends BaseUIResourceDefinition {
  type: "externalUrl";
  /** Widget identifier (e.g., 'kanban-board', 'chart') */
  widget: string;
  /** Adapter configuration */
  adapters?: AdaptersConfig;
  /** Apps SDK metadata fields */
  appsSdkMetadata?: AppsSdkMetadata;
}

/**
 * Raw HTML UI resource - direct HTML content (legacy MCP-UI)
 */
export interface RawHtmlUIResource extends BaseUIResourceDefinition {
  type: "rawHtml";
  /** HTML content to render */
  htmlContent: string;
  /** Adapter configuration */
  adapters?: AdaptersConfig;
  /** Apps SDK metadata fields */
  appsSdkMetadata?: AppsSdkMetadata;
}

/**
 * Remote DOM UI resource - scripted UI components (legacy MCP-UI)
 */
export interface RemoteDomUIResource extends BaseUIResourceDefinition {
  type: "remoteDom";
  /** JavaScript code for remote DOM manipulation */
  script: string;
  /** Framework for remote DOM (defaults to 'react') */
  framework?: RemoteDomFramework;
  /** Adapter configuration */
  adapters?: AdaptersConfig;
  /** Apps SDK metadata fields */
  appsSdkMetadata?: AppsSdkMetadata;
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
  type: "appsSdk";
  /** HTML template content - the component that will be rendered */
  htmlTemplate: string;
  /** Apps SDK-specific metadata */
  appsSdkMetadata?: AppsSdkMetadata;
}

/**
 * Discriminated union of all UI resource types
 */
export type UIResourceDefinition =
  | ExternalUrlUIResource
  | RawHtmlUIResource
  | RemoteDomUIResource
  | AppsSdkUIResource;

export interface WidgetConfig {
  /** Widget directory name */
  name: string;
  /** Absolute path to widget directory */
  path: string;
  /** Widget manifest if present */
  manifest?: WidgetManifest;
  /** Main component file name */
  component?: string;
}

export interface WidgetManifest {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  props?: WidgetProps;
  size?: [string, string];
  assets?: {
    main?: string;
    scripts?: string[];
    styles?: string[];
  };
}

export interface DiscoverWidgetsOptions {
  /** Path to widgets directory (defaults to dist/resources/mcp-use/widgets) */
  path?: string;
  /** Automatically register widgets without manifests */
  autoRegister?: boolean;
  /** Filter widgets by name pattern */
  filter?: string | RegExp;
}
