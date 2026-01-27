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
} from "@modelcontextprotocol/sdk/server/completable.js";
import type { SchemaInput } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { z } from "zod";

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
// eslint-disable-next-line no-redeclare
export function completable<T extends z.ZodTypeAny>(
  schema: T,
  complete: CompleteCallback<T>
): CompletableSchema<T>;

// Implementation
// eslint-disable-next-line no-redeclare
export function completable<T extends z.ZodTypeAny>(
  schema: T,
  complete: z.infer<T>[] | CompleteCallback<T>
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
      return filtered as SchemaInput<T>[];
    };
  } else {
    // Overload 2: pass the callback as is
    callback = complete;
  }

  return sdkCompletable(schema as any, callback); // Type assertion for Zod v3/v4 compatibility
}
