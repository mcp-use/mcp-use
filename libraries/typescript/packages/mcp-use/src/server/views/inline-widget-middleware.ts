/**
 * Inline widget registry types for JSX tool returns.
 *
 * Build-time transform / bundler modules live alongside this file but are
 * wired from the CLI build path (see inline-widget-transform.ts).
 */

import type { CSPConfig, UnifiedWidgetMetadata } from "./adapters/types.js";

/** Registry entry for an inline widget tool. */
export interface InlineWidgetManifestEntry {
  toolName: string;
  widgetName: string;
  componentPath: string;
  invoking?: string;
  invoked?: string;
  visibility?: Array<"model" | "app">;
  fileParams?: string[];
  csp?: CSPConfig;
  prefersBorder?: boolean;
  domain?: string;
  permissions?: UnifiedWidgetMetadata["permissions"];
}
