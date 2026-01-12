import type {
  GetPromptResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { InputDefinition, OptionalizeUndefinedFields } from "./common.js";
import type { z } from "zod";
import type { TypedCallToolResult } from "../utils/response-helpers.js";
import type { McpContext } from "./context.js";

// Re-export MCP SDK types for convenience
export type { GetPromptResult };
// Alias for better naming
export type { GetPromptResult as PromptResult };

/**
 * Enhanced Prompt Context that provides access to request context.
 *
 * This unified context provides:
 * - `auth` - Authentication info (when OAuth is configured)
 * - `req` - Hono request object
 * - All other Hono Context properties and methods
 *
 * @template HasOAuth - Whether OAuth is configured (affects auth availability)
 */
export type EnhancedPromptContext<HasOAuth extends boolean = false> =
  McpContext<HasOAuth>;

/**
 * Extract input type from a prompt definition's schema
 */
export type InferPromptInput<T> = T extends { schema: infer S }
  ? S extends z.ZodTypeAny
    ? OptionalizeUndefinedFields<z.infer<S>>
    : Record<string, any>
  : Record<string, any>;

/**
 * Helper interface that uses method signature syntax to enable bivariant parameter checking.
 * @internal
 */
interface PromptCallbackBivariant<TInput, HasOAuth extends boolean> {
  bivarianceHack(
    params: TInput,
    ctx: EnhancedPromptContext<HasOAuth>
  ): Promise<CallToolResult | GetPromptResult | TypedCallToolResult<any>>;
}

/**
 * Callback type for prompt execution - supports both CallToolResult (from helpers) and GetPromptResult (old API).
 * Uses bivariant parameter checking for flexible destructuring patterns.
 *
 * @template TInput - Input parameters type
 * @template HasOAuth - Whether OAuth is configured (affects ctx.auth availability)
 */
export type PromptCallback<
  TInput = Record<string, any>,
  HasOAuth extends boolean = false,
> = PromptCallbackBivariant<TInput, HasOAuth>["bivarianceHack"];

/**
 * Prompt definition with cb callback (old API)
 */
export interface PromptDefinition<
  TInput = Record<string, any>,
  HasOAuth extends boolean = false,
> {
  /** Unique identifier for the prompt */
  name: string;
  /** Human-readable title for the prompt */
  title?: string;
  /** Description of what the prompt does */
  description?: string;
  /** Argument definitions (legacy, use schema instead) */
  args?: InputDefinition[];
  /** Zod schema for input validation (preferred) */
  schema?: z.ZodObject<any>;
  /** Async callback function that generates the prompt */
  cb: PromptCallback<TInput, HasOAuth>;
}

/**
 * Prompt definition without cb callback (new API with separate callback parameter)
 */
export interface PromptDefinitionWithoutCallback {
  /** Unique identifier for the prompt */
  name: string;
  /** Human-readable title for the prompt */
  title?: string;
  /** Description of what the prompt does */
  description?: string;
  /** Argument definitions (legacy, use schema instead) */
  args?: InputDefinition[];
  /** Zod schema for input validation (preferred) */
  schema?: z.ZodObject<any>;
}
