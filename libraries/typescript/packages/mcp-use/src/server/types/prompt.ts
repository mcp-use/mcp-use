import type {
  GetPromptResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { InputDefinition } from "./common.js";
import type { z } from "zod";
import type { TypedCallToolResult } from "../utils/response-helpers.js";

// Callback types - now support both CallToolResult (from helpers) and GetPromptResult (old API)
export type PromptCallback = (
  params: any
) => Promise<CallToolResult | GetPromptResult | TypedCallToolResult<any>>;

/**
 * Prompt definition with cb callback (old API)
 */
export interface PromptDefinition {
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
  cb: PromptCallback;
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
