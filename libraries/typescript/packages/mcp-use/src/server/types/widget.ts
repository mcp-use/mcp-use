import type { AppsSdkMetadata } from "./resource.js";
import type { InputDefinition, ResourceAnnotations } from "./common.js";
import type { ToolAnnotations } from "./tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export interface WidgetMetadata {
  title?: string;
  description?: string;
  /** Zod schema for widget props validation (preferred) or InputDefinition array */
  props?: z.ZodObject<any> | InputDefinition[];
  /** @deprecated Use `props` instead - Zod schema for widget input validation */
  inputs?: z.ZodObject<any> | InputDefinition[];
  /** @deprecated Use `props` instead - Alias for props to align with tool naming convention */
  schema?: z.ZodObject<any> | InputDefinition[];
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
        params: Record<string, any>
      ) =>
        | CallToolResult
        | import("../utils/response-helpers.js").TypedCallToolResult<any>)
    | CallToolResult
    | import("../utils/response-helpers.js").TypedCallToolResult<any>;
  /** Control automatic tool registration (defaults to true) */
  exposeAsTool?: boolean;
  /** Annotations for both resource and tool - supports both ResourceAnnotations and ToolAnnotations */
  annotations?: ResourceAnnotations & Partial<ToolAnnotations>;
  _meta?: Record<string, unknown>;
  appsSdkMetadata?: AppsSdkMetadata;
}
