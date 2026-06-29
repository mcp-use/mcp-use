/**
 * Completion utilities for prompts and resource templates
 *
 * This module provides utilities for adding autocompletion support to prompt arguments
 * and resource template variables, enabling IDE-like autocomplete experiences for users.
 */

import {
  completable as sdkCompletable,
  type CompletableSchema,
  type CompleteCallback,
} from "@modelcontextprotocol/server";
import type { ResourceTemplateCallbacks } from "../types/resource.js";
import type { CompleteResourceTemplateCallback } from "@modelcontextprotocol/server";
import type { z } from "zod";

/**
 * Context provided to completion callbacks, containing other argument values
 * that may be useful for contextual completion suggestions.
 */
export interface CompletionContext {
  /**
   * Other argument values from the same prompt/resource template.
   * Useful for contextual completion based on previously provided values.
   */
  arguments?: Record<string, unknown>;
}

/**
 * Utility type alias for completable schemas.
 * Use this type when you need to reference a completable schema type.
 *
 * @example
 * type LanguageSchema = Completable<z.ZodString>;
 */
export type Completable<T extends z.ZodTypeAny> = CompletableSchema<T>;

/**
 * Make a schema "completable" so clients can request autocomplete
 * suggestions via MCP `completion/complete`.
 *
 * Usage:
 * - **List-based (primitives only):** pass an array of allowed values for simple
 *   case-insensitive prefix matching.
 * - **Callback-based (any schema):** pass a function for dynamic or contextual suggestions.
 *
 * @param schema Zod schema for the argument (e.g. z.string(), z.number(), z.enum([...]))
 * @param complete List of values (primitives) or a completion callback
 *
 * @returns The same schema with completion metadata attached
 *
 * @example
 * // List-based completion (primitives only)
 * server.prompt(
 *   {
 *     name: "code-review",
 *     schema: z.object({
 *       language: completable(z.string(), ["python", "typescript", "go"]),
 *       code: z.string(),
 *     }),
 *   },
 *   async ({ language, code }) => text(`Reviewing ${language}...`)
 * );
 *
 * @example
 * // Number completion with list
 * server.prompt(
 *   {
 *     name: "select-version",
 *     schema: z.object({
 *       version: completable(z.number(), [1, 2, 3, 10, 20, 30]),
 *     }),
 *   },
 *   async ({ version }) => text(`Selected version ${version}`)
 * );
 *
 * @example
 * // Callback-based completion (dynamic/contextual)
 * server.prompt(
 *   {
 *     name: "analyze-project",
 *     schema: z.object({
 *       projectId: completable(z.string(), async (value, ctx) => {
 *         const userId = ctx?.arguments?.userId;
 *         const projects = await fetchProjects(userId);
 *         return projects.map(p => p.id).filter(id => id.startsWith(value));
 *       }),
 *     }),
 *   },
 *   async ({ projectId }) => text(`Analyzing ${projectId}...`)
 * );
 */

// Overload 1: List (primitives only) for simple cases
export function completable<
  T extends z.ZodString | z.ZodNumber | z.ZodEnum<any>,
>(schema: T, complete: z.infer<T>[]): CompletableSchema<T>;

// Overload 2: Callback (all types) for complex cases

export function completable<T extends z.ZodTypeAny>(
  schema: T,
  complete: (
    value: z.infer<T>,
    context?: CompletionContext
  ) => Promise<z.infer<T>[]> | z.infer<T>[]
): CompletableSchema<T>;

// Implementation

export function completable<T extends z.ZodTypeAny>(
  schema: T,
  complete:
    | z.infer<T>[]
    | ((
        value: z.infer<T>,
        context?: CompletionContext
      ) => Promise<z.infer<T>[]> | z.infer<T>[])
): CompletableSchema<T> {
  let callback: CompleteCallback<T>;

  if (Array.isArray(complete)) {
    // Overload 1: Convert array to callback with prefix filtering
    callback = async (value) => {
      const prefix = (value ?? "").toString().trim().toLowerCase();
      const filtered = complete.filter((item) => {
        return String(item).toLowerCase().startsWith(prefix);
      });
      // Cast to SDK input type for CompleteCallback compatibility
      return filtered as z.infer<T>[];
    };
  } else {
    // Overload 2: wrap the callback to match SDK's CompleteCallback signature
    callback = async (value, context) => {
      return await complete(value as z.infer<T>, context as CompletionContext);
    };
  }

  return sdkCompletable(schema as any, callback); // Type assertion for Zod v3/v4 compatibility
}

/**
 * Normalizes resource template complete options for the SDK.
 * Users can provide either a string array (allowed values) or a callback per variable.
 * String arrays are converted into the default prefix-filter callback; callbacks are passed through unchanged.
 *
 * @param completes - Optional map of variable name to string[] or CompleteResourceTemplateCallback
 * @returns SDK-ready complete map, or empty object when input is undefined/empty
 */
export function toResourceTemplateCompleteCallbacks(
  completes?: ResourceTemplateCallbacks["complete"]
): { [variable: string]: CompleteResourceTemplateCallback } {
  if (!completes) {
    return {};
  }

  const normalized: { [variable: string]: CompleteResourceTemplateCallback } =
    {};
  for (const key of Object.keys(completes)) {
    const complete = completes[key];
    if (Array.isArray(complete)) {
      const callback = async (value: string) => {
        const prefix = (value ?? "").toString().trim().toLowerCase();
        const filtered = complete.filter((item) => {
          return String(item).toLowerCase().startsWith(prefix);
        });
        return filtered;
      };
      normalized[key] = callback;
    } else {
      normalized[key] = complete;
    }
  }
  return normalized;
}
