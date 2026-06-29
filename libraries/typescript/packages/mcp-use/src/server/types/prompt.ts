import type {
  GetPromptResult,
  CallToolResult,
} from "@modelcontextprotocol/server";
import type { OptionalizeUndefinedFields } from "./common.js";
import type { z } from "zod";
import type { TypedCallToolResult } from "../utils/response-helpers.js";
import type { ClientCapabilityChecker, McpContext } from "./context.js";
import type { AuthRequirement } from "../oauth/types.js";

// Re-export MCP SDK types for convenience
export type { GetPromptResult };
// Alias for better naming
export type { GetPromptResult as PromptResult };

/**
 * Enhanced Prompt Context that provides access to request context and
 * client capability information.
 *
 * This unified context provides:
 * - `auth` - Authentication info (when OAuth is configured)
 * - `req` - Hono request object
 * - `client` - Client capability checker (name, capabilities, MCP Apps support)
 * - All other Hono Context properties and methods
 *
 * @template HasOAuth - Whether OAuth is configured (affects auth availability)
 */
export type EnhancedPromptContext<HasOAuth extends boolean = false> =
  McpContext<HasOAuth> & { client: ClientCapabilityChecker };

/**
 * Extract input type from a prompt definition's schema
 */
export type InferPromptInput<T> = T extends { schema: infer S }
  ? S extends z.ZodTypeAny
    ? OptionalizeUndefinedFields<z.infer<S>>
    : Record<string, unknown>
  : Record<string, unknown>;

/**
 * Helper interface that uses method signature syntax to enable bivariant parameter checking.
 * @internal
 */
interface PromptCallbackBivariant<TInput, HasOAuth extends boolean> {
  bivarianceHack(
    params: TInput,
    ctx: EnhancedPromptContext<HasOAuth>
  ): Promise<
    | CallToolResult
    | GetPromptResult
    | TypedCallToolResult<Record<string, unknown>>
  >;
}

/**
 * Callback type for prompt execution - supports both CallToolResult (from helpers) and GetPromptResult.
 * Uses bivariant parameter checking for flexible destructuring patterns.
 *
 * @template TInput - Input parameters type
 * @template HasOAuth - Whether OAuth is configured (affects ctx.auth availability)
 */
export type PromptCallback<
  TInput = Record<string, unknown>,
  HasOAuth extends boolean = false,
> = PromptCallbackBivariant<TInput, HasOAuth>["bivarianceHack"];

/**
 * Prompt definition (metadata only; pass callback as second argument to server.prompt()).
 */
export interface PromptDefinition<
  _TInput = Record<string, unknown>,
  _HasOAuth extends boolean = false,
> {
  /**
   * Unique identifier for the prompt .
   *
   * @example "code-review-template"
   * @example "daily-standup"
   */
  name: string;
  /**
   * Human-readable title displayed in prompt lists.
   *
   * @example "Code Review Template"
   */
  title?: string;
  /**
   * Description of what the prompt does; helps users choose the right prompt.
   *
   * @example "Generate a code review checklist for the given file type"
   */
  description?: string;
  /**
   * Zod schema for input validation. Use .describe() on each field for user guidance.
   *
   * @example z.object({ language: z.string().describe("Programming language"), filePath: z.string().optional().describe("Path to file") })
   */
  schema?: z.ZodObject<z.ZodRawShape>;
  /** Optional authorization requirement enforced on prompts/list and prompts/get */
  auth?: AuthRequirement;
}
