import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { InputDefinition } from "./common.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../mcp-server.js";

/**
 * Callback function for tool execution.
 * Can optionally receive a ToolContext as the second parameter for sampling support.
 */
export type ToolCallback = (
  params: Record<string, any>,
  ctx?: ToolContext
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
  /**
   * Async callback function that executes the tool.
   * Receives tool parameters and optionally a ToolContext for sampling support.
   *
   * @example
   * ```typescript
   * // Simple tool without sampling
   * cb: async ({ name }) => ({
   *   content: [{ type: 'text', text: `Hello, ${name}!` }]
   * })
   *
   * // Tool with sampling support
   * cb: async ({ text }, ctx) => {
   *   const result = await ctx.sample({
   *     messages: [{ role: 'user', content: { type: 'text', text } }]
   *   });
   *   return { content: result.content };
   * }
   * ```
   */
  cb: ToolCallback;
  /** Tool annotations */
  annotations?: ToolAnnotations;
  /** Metadata for the tool */
  _meta?: Record<string, unknown>;
}
