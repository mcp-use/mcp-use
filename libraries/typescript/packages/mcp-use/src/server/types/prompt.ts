import type {
  GetPromptResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { InputDefinition, OptionalizeUndefinedFields } from "./common.js";
import type { z } from "zod";
import type { TypedCallToolResult } from "../utils/response-helpers.js";

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
interface PromptCallbackBivariant<TInput> {
  bivarianceHack(
    params: TInput
  ): Promise<CallToolResult | GetPromptResult | TypedCallToolResult<any>>;
}

/**
 * Callback type for prompt execution - supports both CallToolResult (from helpers) and GetPromptResult (old API).
 * Uses bivariant parameter checking for flexible destructuring patterns.
 */
export type PromptCallback<TInput = Record<string, any>> =
  PromptCallbackBivariant<TInput>["bivarianceHack"];

/**
 * Prompt definition with cb callback (old API)
 */
export interface PromptDefinition<TInput = Record<string, any>> {
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
  cb: PromptCallback<TInput>;
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
