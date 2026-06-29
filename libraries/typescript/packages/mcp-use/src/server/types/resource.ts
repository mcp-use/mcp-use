import type {
  ReadResourceResult,
  CallToolResult,
} from "@modelcontextprotocol/server";
import type { CompleteResourceTemplateCallback } from "@modelcontextprotocol/server";
import type { ResourceAnnotations } from "./common.js";
import type { ToolAnnotations } from "./tool.js";
import type { TypedCallToolResult } from "../utils/response-helpers.js";
import type { ClientCapabilityChecker, McpContext } from "./context.js";
import type { UnifiedWidgetMetadata } from "../views/adapters/types.js";
import type { z } from "zod";
import type { AuthRequirement } from "../oauth/types.js";

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
    /** Domains allowed for iframe embeds (optional - by default widgets cannot render subframes) */
    frame_domains?: string[];
    /** Domains that can receive openExternal redirects without the safe-link modal (optional) */
    redirect_domains?: string[];
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
 * Enhanced Resource Context that provides access to request context and
 * client capability information.
 *
 * This unified context provides:
 * - `auth` - Authentication info (when OAuth is configured)
 * - `req` - Hono request object
 * - `client` - Client capability checker (name, capabilities, MCP Apps support)
 * - All other Hono Context properties and methods
 *
 * @template HasOAuth - Whether OAuth is configured (affects auth availability)
 */
export type EnhancedResourceContext<HasOAuth extends boolean = false> =
  McpContext<HasOAuth> & { client: ClientCapabilityChecker };

/**
 * Helper interface for bivariant parameter checking on resource callbacks.
 * @internal
 */
interface ReadResourceCallbackBivariant<HasOAuth extends boolean> {
  bivarianceHack(
    ctx: EnhancedResourceContext<HasOAuth>
  ): Promise<
    | CallToolResult
    | ReadResourceResult
    | TypedCallToolResult<Record<string, unknown>>
  >;
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
 * Extract template params type from a resource template definition's schema.
 * Mirrors InferToolInput from tool.ts.
 */
export type InferTemplateParams<T> = T extends { schema: infer S }
  ? S extends z.ZodTypeAny
    ? z.infer<S>
    : Record<string, unknown>
  : Record<string, unknown>;

/**
 * Callback type for reading a resource template with parameters.
 * Supports both CallToolResult (from helpers) and ReadResourceResult (old API).
 *
 * Supports multiple callback signatures:
 * - `async () => ...` - No parameters
 * - `async (uri: URL) => ...` - Just URI (required)
 * - `async (uri: URL, params: TParams) => ...` - URI and parameters (both required)
 * - `async (uri: URL, params: TParams, ctx: EnhancedResourceContext) => ...` - All parameters (all required)
 *
 * The implementation checks callback.length to determine which signature to use.
 *
 * @template TParams - Type for URI template parameters (defaults to Record<string, unknown>)
 * @template HasOAuth - Whether OAuth is configured (affects ctx.auth availability)
 */
export type ReadResourceTemplateCallback<
  TParams extends Record<string, unknown> = Record<string, unknown>,
  HasOAuth extends boolean = false,
> =
  | (() => Promise<
      | CallToolResult
      | ReadResourceResult
      | TypedCallToolResult<Record<string, unknown>>
    >)
  | ((
      uri: URL
    ) => Promise<
      | CallToolResult
      | ReadResourceResult
      | TypedCallToolResult<Record<string, unknown>>
    >)
  | ((
      uri: URL,
      params: TParams
    ) => Promise<
      | CallToolResult
      | ReadResourceResult
      | TypedCallToolResult<Record<string, unknown>>
    >)
  | ((
      uri: URL,
      params: TParams,
      ctx: EnhancedResourceContext<HasOAuth>
    ) => Promise<
      | CallToolResult
      | ReadResourceResult
      | TypedCallToolResult<Record<string, unknown>>
    >);

/**
 * Complete callback for a resource template
 */
export interface ResourceTemplateCallbacks {
  complete?: {
    [variable: string]: string[] | CompleteResourceTemplateCallback;
  };
}

/**
 * Resource template definition (metadata only; pass callback as second argument to server.resourceTemplate()).
 */
export interface ResourceTemplateDefinition<
  _HasOAuth extends boolean = false,
  _TParams extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Unique identifier for the template.
   *
   * @example "user-profile"
   */
  name: string;
  /**
   * URI template with {param} placeholders for dynamic resources.
   *
   * @example "user://{userId}/profile"
   * @example "repo://{owner}/{repo}/file/{path}"
   */
  uriTemplate: string;
  /**
   * Human-readable title for the resource.
   *
   * @example "User Profile"
   */
  title?: string;
  /**
   * Description of what the resource contains.
   *
   * @example "User profile data for the given userId"
   */
  description?: string;
  /**
   * MIME type of the resource content (e.g., "text/plain", "application/json").
   *
   * @example "application/json"
   */
  mimeType?: string;
  /** Optional annotations for the resource */
  annotations?: ResourceAnnotations;
  /** Optional authorization requirement enforced on resources/list and resources/read */
  auth?: AuthRequirement;
  /**
   * Optional Zod schema for URI template parameters. When provided, narrows
   * the `params` argument in the callback to `z.infer<schema>`.
   *
   * @example z.object({ id: z.string() })
   */
  schema?: z.ZodTypeAny;
  _meta?: Record<string, unknown>;
  /** Complete callback for the resource template */
  callbacks?: ResourceTemplateCallbacks;
}

/**
 * Resource definition (metadata only; pass callback as second argument to server.resource()).
 */
export interface ResourceDefinition<_HasOAuth extends boolean = false> {
  /**
   * Unique identifier for the resource.
   *
   * @example "app-settings"
   */
  name: string;
  /**
   * URI pattern for accessing the resource. Use a custom scheme (e.g., config://, app://).
   *
   * @example "config://app-settings"
   * @example "app://greeting"
   */
  uri: string;
  /**
   * Human-readable title for the resource.
   *
   * @example "App Settings"
   */
  title?: string;
  /**
   * Description of what the resource contains.
   *
   * @example "Application configuration and user preferences"
   */
  description?: string;
  /**
   * MIME type (optional when using text(), object(), etc.—inferred from the helper).
   *
   * @example "application/json"
   */
  mimeType?: string;
  /** Optional annotations for the resource */
  annotations?: ResourceAnnotations;
  /** Optional authorization requirement enforced on resources/list and resources/read */
  auth?: AuthRequirement;
  _meta?: Record<string, unknown>;
  /** Complete callback for the resource template */
  callbacks?: ResourceTemplateCallbacks;
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
 * Base properties shared by all UI resource types
 */
interface BaseUIResourceDefinition {
  /**
   * Unique identifier for the resource/widget.
   *
   * @example "weather-display"
   * @example "product-search-result"
   */
  name: string;
  /**
   * Human-readable title for the widget.
   *
   * @example "Weather Display"
   */
  title?: string;
  /**
   * Description of what the widget does; helps the model understand when to use it.
   *
   * @example "Display weather information for a city"
   */
  description?: string;
  /**
   * Widget properties/parameters configuration.
   * Each key maps to a prop schema with type, required, default, description.
   */
  props?: WidgetProps;
  /**
   * Preferred frame size [width, height].
   *
   * @example ["800px", "600px"]
   */
  size?: [string, string];
  /** Resource annotations for discovery and presentation */
  annotations?: ResourceAnnotations;
  /**
   * Encoding for the resource content (defaults to 'text').
   * Use 'blob' for binary content.
   */
  encoding?: UIEncoding;
  /**
   * Whether to auto-register this widget as an MCP tool (defaults to true).
   * Set to false when the widget is paired with a custom server.tool().
   */
  exposeAsTool?: boolean;
  /** Tool annotations when registered as a tool */
  toolAnnotations?: ToolAnnotations;
  /**
   * For auto-registered widgets: function or helper that generates the tool output (what the model sees).
   * If not provided, defaults to a summary message.
   * @example
   * ```typescript
   * // As a function
   * toolOutput: (params) => text(`Found ${params.count} items`)
   *
   * // As a static helper
   * toolOutput: text('Processing complete')
   *
   * // With object helper
   * toolOutput: (params) => object({ count: params.count })
   * ```
   */
  toolOutput?:
    | ((
        params: Record<string, unknown>
      ) =>
        | import("@modelcontextprotocol/server").CallToolResult
        | import("../utils/response-helpers.js").TypedCallToolResult<
            Record<string, unknown>
          >)
    | import("@modelcontextprotocol/server").CallToolResult
    | import("../utils/response-helpers.js").TypedCallToolResult<
        Record<string, unknown>
      >;

  _meta?: Record<string, unknown>;
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
 * MCP Apps UI resource - Official MCP Apps Extension (SEP-1865) compatible widget
 *
 * This type follows the official MCP Apps Extension pattern:
 * - Uses text/html;profile=mcp-app mime type
 * - Dual-protocol support: works with both ChatGPT and MCP Apps clients
 * - Unified metadata format that adapters transform to protocol-specific formats
 * - Supports MCP Apps CSP, widget preferences, and other metadata
 *
 * @see https://github.com/modelcontextprotocol/ext-apps
 * @see https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/
 */
export interface McpAppsUIResource extends BaseUIResourceDefinition {
  type: "mcpApps";
  /** HTML template content - the component that will be rendered */
  htmlTemplate: string;
  /** Unified metadata that works with both protocols (follows SEP-1865 + ChatGPT extensions) */
  metadata?: UnifiedWidgetMetadata;
  /** Optional: Apps SDK-specific metadata for advanced ChatGPT features */
  appsSdkMetadata?: AppsSdkMetadata;
}

/**
 * Discriminated union of all UI resource types
 */
export type UIResourceDefinition = AppsSdkUIResource | McpAppsUIResource;

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
  /**
   * Unique widget identifier (must match directory/file name).
   *
   * @example "weather-display"
   */
  name: string;
  /**
   * Human-readable title.
   *
   * @example "Weather Display"
   */
  title?: string;
  /**
   * Description of what the widget displays.
   *
   * @example "Display weather information for a city"
   */
  description?: string;
  /**
   * Semantic version of the widget.
   *
   * @example "1.0.0"
   */
  version?: string;
  /** Widget props schema (type, required, default per prop) */
  props?: WidgetProps;
  /**
   * Preferred frame size [width, height].
   *
   * @example ["800px", "600px"]
   */
  size?: [string, string];
  /** Asset paths for scripts, styles, main entry */
  assets?: {
    main?: string;
    scripts?: string[];
    styles?: string[];
  };
}

export interface DiscoverWidgetsOptions {
  /**
   * Path to widgets directory.
   * Defaults to dist/resources/mcp-use/widgets.
   *
   * @example "./resources/widgets"
   */
  path?: string;
  /**
   * Automatically register widgets that don't have manifests.
   * Defaults to false.
   */
  autoRegister?: boolean;
  /**
   * Filter widgets by name pattern (string or RegExp).
   *
   * @example "weather-*"
   */
  filter?: string | RegExp;
}
