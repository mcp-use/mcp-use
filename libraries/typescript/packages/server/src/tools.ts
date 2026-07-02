import type {
  CallToolResult,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from "@modelcontextprotocol/server";

import type { RequestContext } from "./context.js";

/** Declares a tool's identity, LLM-facing description, and schemas. First argument to {@link MCPServer.tool}. */
export interface ToolDefinition {
  /** Unique tool identifier, e.g. `"fetch-weather"`. */
  name: string;
  /** Human-readable title shown in UIs (falls back to `name`). */
  title?: string;
  /** LLM-facing description of what the tool does. */
  description?: string;
  /**
   * Object schema for input validation — any Standard Schema library with
   * JSON Schema conversion ({@link StandardSchemaWithJSON}): zod v4, ArkType,
   * Valibot, …. Field descriptions become LLM hints. Input is validated by
   * the SDK before the callback runs.
   */
  schema?: StandardSchemaWithJSON;
  /**
   * Schema for structured output ({@link StandardSchemaWithJSON}). Any JSON
   * root is allowed — object, array, or primitive (2026-07-28 protocol).
   * When set, the callback must return a result carrying matching
   * `structuredContent` or an explicit `isError` result — enforced at
   * compile time and validated by the SDK at runtime.
   */
  outputSchema?: StandardSchemaWithJSON;
  /** Behavioral hints for clients (readOnlyHint, destructiveHint, …). */
  annotations?: ToolAnnotations;
}

/**
 * Result a tool callback may return, keyed by the tool's inferred output
 * type. The shape is the SDK's raw {@link CallToolResult} — there is no
 * framework-specific result layer.
 *
 * Without an `outputSchema` (`TOutput = never`) any `CallToolResult` is
 * accepted. With one, the result must carry `structuredContent` matching the
 * schema or set `isError: true` — mirroring the SDK's runtime rule, which
 * rejects results from schema'd tools that carry no structured content
 * unless `isError` is set.
 *
 * The SDK auto-appends a JSON text block when `structuredContent` is a
 * non-object value and no `type: "text"` block is present; for object-shaped
 * payloads include the text serialization yourself:
 *
 * ```ts
 * return {
 *   content: [{ type: "text", text: JSON.stringify(data) }],
 *   structuredContent: data,
 * };
 * ```
 */
export type ToolResult<TOutput = never> = [TOutput] extends [never]
  ? CallToolResult
  :
      | (CallToolResult & { structuredContent: TOutput })
      | (CallToolResult & { isError: true });

/** Infer the callback params type from a tool definition's `schema`. */
export type InferToolInput<T> = T extends {
  schema: infer S extends StandardSchemaWithJSON;
}
  ? StandardSchemaWithJSON.InferOutput<S> extends Record<string, unknown>
    ? StandardSchemaWithJSON.InferOutput<S>
    : Record<string, unknown>
  : Record<string, unknown>;

/**
 * Infer the structured output type from a definition's `outputSchema` —
 * any JSON root, not just objects (2026-07-28 protocol); `never` when the
 * definition declares none (any {@link CallToolResult} is then accepted —
 * see {@link ToolResult}).
 */
export type InferToolOutput<T> = T extends {
  outputSchema: infer S extends StandardSchemaWithJSON;
}
  ? StandardSchemaWithJSON.InferOutput<S>
  : never;

/**
 * Tool execution callback. The return type is {@link ToolResult}: tools with
 * an `outputSchema` must return matching `structuredContent` or an `isError`
 * result; tools without one accept any {@link CallToolResult}.
 */
export type ToolCallback<
  TInput = Record<string, unknown>,
  TOutput = never,
> = (
  params: TInput,
  ctx: RequestContext
) => ToolResult<TOutput> | Promise<ToolResult<TOutput>>;
