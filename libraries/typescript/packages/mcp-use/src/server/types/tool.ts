import type { InputDefinition } from "./common.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "./tool-context.js";
import type { McpContext } from "./context.js";
import type { z } from "zod";
import type { TypedCallToolResult } from "../utils/response-helpers.js";

// Re-export MCP SDK types for convenience
export type { ToolAnnotations };

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
 * Callback function interface for tool execution.
 *
 * Uses method signature syntax to enable bivariant parameter checking,
 * which allows more flexible destructuring patterns for optional fields.
 *
 * Accepts input parameters and an optional enhanced context object that provides:
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
/**
 * Helper interface that uses method signature syntax to enable bivariant parameter checking.
 * This allows more flexible callback assignments where users can destructure optional fields
 * without explicitly marking them as optional in their function signature.
 *
 * @internal
 */
interface ToolCallbackBivariant<
  TInput,
  TOutput extends Record<string, unknown>,
  HasOAuth extends boolean,
> {
  // Method signature enables bivariant checking for TInput parameter
  bivarianceHack(
    params: TInput,
    ctx: EnhancedToolContext<HasOAuth>
  ): Promise<TypedCallToolResult<TOutput>>;
}

/**
 * Callback function type for tool execution.
 *
 * Uses bivariant parameter checking via method signature extraction,
 * which allows more flexible destructuring patterns for optional fields.
 *
 * Accepts input parameters and an enhanced context object that provides:
 * - LLM sampling via `ctx.sample()`
 * - Progress reporting via `ctx.reportProgress()`
 * - Elicitation via `ctx.elicit()`
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
 * async ({ name }) => ({
 *   content: [{ type: 'text', text: `Hello, ${name}!` }]
 * })
 *
 * // Tool with sampling and context
 * async ({ text }, ctx) => {
 *   const result = await ctx.sample({
 *     messages: [{ role: 'user', content: { type: 'text', text } }]
 *   });
 *   return { content: result.content };
 * }
 *
 * // Tool with authentication
 * async ({ userId }, ctx) => {
 *   return { content: [{ type: 'text', text: `User: ${ctx.auth.user.email}` }] };
 * }
 * ```
 */
export type ToolCallback<
  TInput = Record<string, any>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
  HasOAuth extends boolean = false,
> = ToolCallbackBivariant<TInput, TOutput, HasOAuth>["bivarianceHack"];

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
 * Extract input type from a tool definition's schema.
 * Uses z.infer which preserves Zod's optional/default handling.
 *
 * For .optional() fields, the type will be T | undefined
 * For .default() fields, the type will be T (since Zod guarantees a value)
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
