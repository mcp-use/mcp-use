import type { AppsSdkMetadata } from "./resource.js";
import type { InputDefinition, ResourceAnnotations } from "./common.js";
import type { ToolAnnotations } from "./tool.js";
import type { z } from "zod";

export interface WidgetMetadata {
  title?: string;
  description?: string;
  /** Zod schema for input validation (preferred) or InputDefinition array */
  inputs?: z.ZodObject<any> | InputDefinition[];
  /** Alias for inputs to align with tool naming convention */
  schema?: z.ZodObject<any> | InputDefinition[];
  /** Control automatic tool registration (defaults to true) */
  exposeAsTool?: boolean;
  /** Annotations for both resource and tool - supports both ResourceAnnotations and ToolAnnotations */
  annotations?: ResourceAnnotations & Partial<ToolAnnotations>;
  _meta?: Record<string, unknown>;
  appsSdkMetadata?: AppsSdkMetadata;
}
