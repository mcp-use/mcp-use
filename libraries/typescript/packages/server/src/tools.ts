import type {
  CallToolResult,
  InputRequiredResult,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from "@modelcontextprotocol/server";

import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps";

import type { RequestContext } from "./context.js";
import type { UiPermissions } from "./views/types.js";

/**
 * Binds a tool to a view directory for MCP Apps rendering.
 *
 * Any number of tools may share the same `name`. Resource facts
 * (`description`, `csp`, `permissions`, `domain`, `prefersBorder`) have one
 * authoring point — at most one binder may declare them; others pass only
 * `{ name }`. The view file exports only the component; the framework reads
 * these fields at registration and emits them on the bound view's MCP
 * resource (hosts read resource `_meta.ui`, not tool-level copies).
 */
export interface ToolViewConfig {
  /** View directory / manifest name, e.g. `"product-search-result"`. */
  name: string;
  /**
   * Human-readable description of the view resource → the resource's
   * `description` on `resources/list` and `resources/read`.
   */
  description?: string;
  /**
   * CSP domains the host must allow → resource `_meta.ui.csp`. The framework
   * auto-appends its serving origin to `resourceDomains` at emission time;
   * other author-set fields (`frameDomains`, `baseUriDomains`, …) pass through.
   */
  csp?: McpUiResourceCsp;
  /** Sandbox permissions the view needs → resource `_meta.ui.permissions`. */
  permissions?: UiPermissions;
  /**
   * Dedicated origin hint for hosts that render views on a separate domain →
   * resource `_meta.ui.domain`.
   */
  domain?: string;
  /**
   * Ask the host to draw a border around the view → resource
   * `_meta.ui.prefersBorder`.
   */
  prefersBorder?: boolean;
}

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
   * the SDK before the callback runs. Emitted on the wire as `inputSchema`.
   */
  inputSchema?: StandardSchemaWithJSON;
  /**
   * Alias for {@link ToolDefinition.inputSchema}. Prefer `inputSchema` in new
   * code — it matches the MCP wire field name.
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
  /**
   * Declares who may call or see the tool. Emitted as `_meta.ui.visibility`
   * on `tools/list`. Omitted = host default (callable by the model, visible
   * to the app). The server always lists every registered tool — hosts
   * filter by this declaration; the server never omits tools from
   * `tools/list`. `"app"` marks app-private helper tools callable from
   * views via `useCallTool` while the host hides them from the model.
   */
  visibility?: "model" | "app";
  /**
   * Bind this tool to a view for MCP Apps rendering. Requires
   * {@link ToolDefinition.outputSchema} — the view reads the result's
   * `structuredContent` typed by this schema.
   */
  view?: ToolViewConfig;
}

/**
 * Handle returned by {@link MCPServer.tool} — carries the tool name at runtime
 * and phantom input/output types for inference (e.g. `Register` / `useCallTool`).
 */
export interface ToolRef<
  Name extends string = string,
  Input = Record<string, unknown>,
  Output = never,
> {
  /** The tool's registered name. */
  readonly name: Name;
  /**
   * Phantom carrier for the tool's inferred input/output types. Never set at
   * runtime.
   *
   * @internal
   */
  readonly "~types"?: { input: Input; output: Output };
}

/**
 * Result a tool callback may return, keyed by the tool's inferred output
 * type. Completed calls use the SDK's raw {@link CallToolResult}; interactive
 * calls may return an {@link InputRequiredResult}. There is no
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
export type ToolResult<TOutput = never> =
  | InputRequiredResult
  | ([TOutput] extends [never]
      ? CallToolResult
      :
          | (CallToolResult & { structuredContent: TOutput })
          | (CallToolResult & { isError: true }));

/** Infer the callback params type from a tool definition's input schema. */
export type InferToolInput<T> = T extends {
  inputSchema: infer S extends StandardSchemaWithJSON;
}
  ? StandardSchemaWithJSON.InferOutput<S> extends Record<string, unknown>
    ? StandardSchemaWithJSON.InferOutput<S>
    : Record<string, unknown>
  : T extends {
        schema: infer S extends StandardSchemaWithJSON;
      }
    ? StandardSchemaWithJSON.InferOutput<S> extends Record<string, unknown>
      ? StandardSchemaWithJSON.InferOutput<S>
      : Record<string, unknown>
    : Record<string, unknown>;

/**
 * Resolve a tool definition's input schema. `inputSchema` wins when both are
 * set.
 *
 * @internal
 */
export function resolveToolInputSchema(
  definition: Pick<ToolDefinition, "inputSchema" | "schema">
): StandardSchemaWithJSON | undefined {
  return definition.inputSchema ?? definition.schema;
}

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

/** Infer the literal tool name from a definition's `name` field. */
export type InferToolName<T> = T extends { name: infer N extends string }
  ? N
  : string;

/**
 * Tool execution callback. The return type is {@link ToolResult}: tools with
 * an `outputSchema` must return matching `structuredContent` or an `isError`
 * result; tools without one accept any {@link CallToolResult}.
 */
export type ToolCallback<
  TInput = Record<string, unknown>,
  TOutput = never,
  TUser = never,
  HasOAuth extends boolean = false,
> = (
  params: TInput,
  ctx: RequestContext<TUser, HasOAuth>
) => ToolResult<TOutput> | Promise<ToolResult<TOutput>>;
