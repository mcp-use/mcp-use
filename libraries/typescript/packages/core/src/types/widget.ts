import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

/**
 * CSP configuration (unified format)
 *
 * Maps to protocol-specific CSP formats:
 * - MCP Apps: camelCase (connectDomains, resourceDomains)
 * - Apps SDK: snake_case (connect_domains, resource_domains)
 *
 * Follows SEP-1865 specification with support for arbitrary additional properties.
 */
export interface CSPConfig {
  /**
   * Domains allowed for fetch/XHR/WebSocket connections
   */
  connectDomains?: string[];

  /**
   * Domains allowed for images, scripts, stylesheets, fonts
   */
  resourceDomains?: string[];

  /**
   * Allowed iframe origins
   */
  frameDomains?: string[];

  /**
   * Allowed base URIs for the document (SEP-1865)
   */
  baseUriDomains?: string[];

  /**
   * Domains for openExternal without confirmation modal
   * (ChatGPT only - not in SEP-1865)
   */
  redirectDomains?: string[];

  /**
   * CSP directive literals to include in script-src
   * (e.g., 'unsafe-eval', 'unsafe-inline', 'unsafe-hashes')
   *
   * Use with caution - these weaken security but may be needed for
   * certain frameworks or development tools.
   */
  scriptDirectives?: string[];

  /**
   * CSP directive literals to include in style-src
   * (e.g., 'unsafe-inline', 'unsafe-hashes')
   */
  styleDirectives?: string[];

  /**
   * Allow arbitrary additional properties for future spec evolution
   */
  [key: string]: any;
}

/**
 * Apps SDK resource metadata fields
 *
 * These fields are set on the resource itself (in resource._meta).
 * They control how the widget is rendered and secured.
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
 * Input parameter definition (legacy; prefer Zod schema with .describe()).
 * Used by tools.inputs and prompts.args.
 */
export interface InputDefinition {
  /**
   * Parameter name (camelCase or kebab-case).
   */
  name: string;
  /**
   * Parameter type.
   */
  type: "string" | "number" | "boolean" | "object" | "array";
  /**
   * Human-readable description; helps the model understand the parameter.
   */
  description?: string;
  /**
   * Whether the parameter is required (defaults to false).
   */
  required?: boolean;
  /**
   * Default value when the parameter is omitted.
   */
  default?: unknown;
}

/**
 * Annotations provide hints to clients about how to use or display resources
 */
export interface ResourceAnnotations {
  /**
   * Intended audience(s) for this resource.
   */
  audience?: ("user" | "assistant")[];
  /**
   * Priority from 0.0 (least important) to 1.0 (most important).
   * Clients may use this for ordering or filtering.
   */
  priority?: number;
  /**
   * ISO 8601 formatted timestamp of last modification.
   */
  lastModified?: string;
}

export interface WidgetMetadata {
  /**
   * Human-readable title for the widget.
   */
  title?: string;
  /**
   * Description of what the widget displays.
   * Used by auto-registered tool descriptions and shown to the model.
   */
  description?: string;
  /**
   * Zod schema for widget props validation (preferred) or InputDefinition array.
   * Props are auto-typed into the component signature.
   */
  props?: z.ZodTypeAny | InputDefinition[];
  /** @deprecated Use `props` instead - Zod schema for widget input validation */
  inputs?: z.ZodTypeAny | InputDefinition[];
  /** @deprecated Use `props` instead - Alias for props to align with tool naming convention */
  schema?: z.ZodTypeAny | InputDefinition[];
  /**
   * For auto-registered widgets: function or helper that generates the tool output (what the model sees).
   * If not provided, defaults to a summary message.
   */
  toolOutput?:
    | ((
        params: Record<string, any>
      ) => CallToolResult | any)
    | CallToolResult
    | any;
  /**
   * Whether to auto-register this widget as an MCP tool (defaults to true).
   * Set to false when the widget is paired with a custom server.tool().
   */
  exposeAsTool?: boolean;
  /** Annotations for both resource and tool - supports both ResourceAnnotations and ToolAnnotations */
  annotations?: ResourceAnnotations & Partial<ToolAnnotations>;
  /** Optional metadata for the widget */
  _meta?: Record<string, unknown>;

  /**
   * Apps SDK-specific metadata (legacy ChatGPT-only format)
   *
   * @deprecated Prefer `metadata` for automatic dual-protocol compatibility
   */
  appsSdkMetadata?: AppsSdkMetadata;

  /**
   * Unified metadata for dual-protocol support
   */
  metadata?: {
    /** Description of the widget */
    description?: string;
    /** Content Security Policy configuration (works for both protocols) */
    csp?: CSPConfig;
    /** Request a visible border around the widget (works for both protocols) */
    prefersBorder?: boolean;
    /** Dedicated domain for widget isolation (ChatGPT only, ignored by MCP Apps) */
    domain?: string;
    /** Human-readable summary for the AI model (ChatGPT only, ignored by MCP Apps) */
    widgetDescription?: string;
    /** Enable automatic size change notifications (MCP Apps only, ignored by ChatGPT) */
    autoResize?: boolean;
    /**
     * Status text shown while the tool is running.
     * Maps to `openai/toolInvocation/invoking` in tool metadata.
     * Auto-default: `"Loading {name}..."`
     */
    invoking?: string;
    /**
     * Status text shown after the tool completes.
     * Maps to `openai/toolInvocation/invoked` in tool metadata.
     * Auto-default: `"{name} ready"`
     */
    invoked?: string;
  };
}
