import type { InputDefinition } from "./common.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../mcp-server.js";
import type { McpContext } from "./context.js";
import type { z } from "zod";
import type { TypedCallToolResult } from "../utils/response-helpers.js";

/**
 * Enhanced Tool Context that combines ToolContext methods with Hono request context.
 *
 * This unified context provides:
 * - `sample()` - LLM sampling method from ToolContext
 * - `reportProgress()` - Progress reporting from ToolContext
 * - `auth` - Authentication info (when OAuth is configured)
 * - `req` - Hono request object
 * - All other Hono Context properties and methods
 *
 * @template HasOAuth - Whether OAuth is configured (affects auth availability)
 */
export type EnhancedToolContext<HasOAuth extends boolean = false> =
  ToolContext & McpContext<HasOAuth>;

/**
 * Callback function for tool execution.
 *
 * Accepts input parameters and an enhanced context object that provides:
 * - LLM sampling via `ctx.sample()`
 * - Progress reporting via `ctx.reportProgress()`
 * - Authentication info via `ctx.auth` (when OAuth is configured)
 * - HTTP request via `ctx.req`
 * - All Hono Context properties and methods
 *
 * @template TInput - Input parameters type
 * @template TOutput - Output type (constrains the structuredContent property when outputSchema is defined)
 * @template HasOAuth - Whether OAuth is configured (affects ctx.auth availability)
 *
 * @example
 * ```typescript
 * // Simple tool without context
 * cb: async ({ name }) => ({
 *   content: [{ type: 'text', text: `Hello, ${name}!` }]
 * })
 *
 * // Tool with sampling
 * cb: async ({ text }, ctx) => {
 *   const result = await ctx.sample({
 *     messages: [{ role: 'user', content: { type: 'text', text } }]
 *   });
 *   return { content: result.content };
 * }
 *
 * // Tool with authentication
 * cb: async ({ userId }, ctx) => {
 *   return { content: [{ type: 'text', text: `User: ${ctx.auth.user.email}` }] };
 * }
 * ```
 */
export type ToolCallback<
  TInput = Record<string, any>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
  HasOAuth extends boolean = false,
> =
  | ((params: TInput) => Promise<TypedCallToolResult<TOutput>>)
  | ((
      params: TInput,
      ctx: EnhancedToolContext<HasOAuth>
    ) => Promise<TypedCallToolResult<TOutput>>);

/**
 * Generic callback with full context support for better type inference.
 * This variant always requires the context parameter.
 */
export type ToolCallbackWithContext<
  TInput = Record<string, any>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
  HasOAuth extends boolean = false,
> = (
  params: TInput,
  ctx: EnhancedToolContext<HasOAuth>
) => Promise<TypedCallToolResult<TOutput>>;

/**
 * Extract input type from a tool definition's schema
 */
export type InferToolInput<T> = T extends { schema: infer S }
  ? S extends z.ZodTypeAny
    ? z.infer<S>
    : Record<string, any>
  : Record<string, any>;

/**
 * Extract output type from a tool definition's output schema
 */
export type InferToolOutput<T> = T extends { outputSchema: infer S }
  ? S extends z.ZodTypeAny
    ? z.infer<S>
    : Record<string, unknown>
  : Record<string, unknown>;

export interface ToolDefinition<
  TInput = Record<string, any>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
  HasOAuth extends boolean = false,
> {
  /** Unique identifier for the tool */
  name: string;
  /** Human-readable title for the tool (displayed in UI) */
  title?: string;
  /** Description of what the tool does (optional) */
  description?: string;
  /** Input parameter definitions (legacy, use schema instead) */
  /** @deprecated Use schema instead */
  inputs?: InputDefinition[];
  /** Zod schema for input validation (alias for inputs, preferred) */
  schema?: z.ZodObject<any>;
  /** Zod schema for structured output validation */
  outputSchema?: z.ZodObject<any>;
  /**
   * Async callback function that executes the tool.
   * Receives tool parameters and an enhanced context with sampling, auth, and request info.
   *
   * @example
   * ```typescript
   * // Simple tool without context
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
   *
   * // Tool with authentication
   * cb: async ({ userId }, ctx) => {
   *   return { content: [{ type: 'text', text: `User: ${ctx.auth.user.email}` }] };
   * }
   * ```
   */
  cb?: ToolCallback<TInput, TOutput, HasOAuth>;
  /** Tool annotations */
  annotations?: ToolAnnotations;
  /** Metadata for the tool */
  _meta?: Record<string, unknown>;
}
