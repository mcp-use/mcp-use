import type { AppsSdkMetadata } from "./resource.js";
import type { InputDefinition, ResourceAnnotations } from "./common.js";
import type { ToolAnnotations } from "./tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { CSPConfig } from "../widgets/adapters/types.js";

export interface WidgetMetadata {
  /**
   * Human-readable title for the widget.
   *
   * @example "Weather Display"
   * @example "Product Search Results"
   */
  title?: string;
  /**
   * Description of what the widget displays.
   * Used by auto-registered tool descriptions and shown to the model.
   *
   * @example "Display fruit search results"
   * @example "Display weather information for a city"
   */
  description?: string;
  /**
   * Zod schema for widget props validation (preferred) or InputDefinition array.
   * Props are auto-typed into the component signature.
   *
   * @example z.object({ city: z.string(), temperature: z.number() })
   */
  props?: z.ZodTypeAny | InputDefinition[];
  /** @deprecated Use `props` instead - Zod schema for widget input validation */
  inputs?: z.ZodTypeAny | InputDefinition[];
  /** @deprecated Use `props` instead - Alias for props to align with tool naming convention */
  schema?: z.ZodTypeAny | InputDefinition[];
  /**
   * For auto-registered widgets: function or helper that generates the tool output (what the model sees).
   * If not provided, defaults to a summary message.
   *
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
        params: Record<string, any>
      ) =>
        | CallToolResult
        | import("../utils/response-helpers.js").TypedCallToolResult<any>)
    | CallToolResult
    | import("../utils/response-helpers.js").TypedCallToolResult<any>;
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
   * For backward compatibility with existing ChatGPT-only widgets.
   *
   * **For new widgets**: Use `metadata` instead for dual-protocol support!
   *
   * @deprecated Prefer `metadata` for automatic dual-protocol compatibility
   */
  appsSdkMetadata?: AppsSdkMetadata;

  /**
   * Unified metadata for dual-protocol support
   *
   * **Automatic Compatibility**: When you use this field, your widget automatically works with:
   * - ✅ ChatGPT (generates Apps SDK metadata with snake_case CSP)
   * - ✅ MCP Apps clients like Claude, Goose, etc. (generates MCP Apps metadata with camelCase CSP)
   *
   * You write the configuration once, and the server generates metadata in BOTH formats.
   * No need to specify a "type" field - it just works everywhere!
   *
   * @example
   * ```typescript
   * export const widgetMetadata: WidgetMetadata = {
   *   description: "Weather display",
   *   props: z.object({ city: z.string() }),
   *   metadata: {
   *     csp: {
   *       connectDomains: ["https://api.weather.com"],
   *       resourceDomains: ["https://cdn.weather.com"]
   *     },
   *     prefersBorder: true,
   *     widgetDescription: "Shows weather info", // ChatGPT will use this
   *     autoResize: true, // MCP Apps clients will use this
   *   }
   * };
   * ```
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
  };
}
