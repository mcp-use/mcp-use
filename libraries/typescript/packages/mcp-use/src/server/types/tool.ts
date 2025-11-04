import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { InputDefinition } from "./common.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type ToolCallback = (
  params: Record<string, any>
) => Promise<CallToolResult>;

export interface ToolDefinition {
  /** Unique identifier for the tool */
  name: string;
  /** Human-readable title for the tool (displayed in UI) */
  title?: string;
  /** Description of what the tool does */
  description?: string;
  /** Input parameter definitions */
  inputs?: InputDefinition[];
  /** Async callback function that executes the tool */
  cb: ToolCallback;
  /** Tool annotations */
  annotations?: ToolAnnotations;
  /** Metadata for the tool */
  _meta?: Record<string, unknown>;
}
