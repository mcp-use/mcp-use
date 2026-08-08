import type {
  Annotations,
  CallToolResult,
  CompleteResourceTemplateCallback,
  MetaObject,
  ReadResourceResult,
} from "@modelcontextprotocol/server";
import type { Env } from "hono";

import type { RequestContext } from "./context.js";

/** Declares a static resource at a fixed URI. First argument to {@link MCPServer.resource}. */
export interface ResourceDefinition {
  /** Resource display name. */
  name: string;
  /** Unique resource URI, e.g. `"config://settings"`. */
  uri: string;
  /** Human-readable title (falls back to `name`). */
  title?: string;
  /** Human-readable description. */
  description?: string;
  /**
   * MIME type advertised in resource listings. Contents entries carry their
   * own `mimeType` on the wire — set it in the callback's result.
   */
  mimeType?: string;
  /** Standard MCP hints describing the resource's audience and presentation. */
  annotations?: Annotations;
  /**
   * Extension metadata advertised on this resource's `resources/list`
   * descriptor. Use vendor-namespaced keys for custom data.
   *
   * This value is not copied into `resources/read` content entries; content
   * metadata must be returned by the callback on each entry's own `_meta`.
   */
  _meta?: MetaObject;
}

/**
 * Resource read callback. Prefer the SDK's raw {@link ReadResourceResult};
 * each `contents` entry addresses itself with the read `uri`.
 *
 * Deprecated response helpers that return a {@link CallToolResult} are still
 * accepted and converted at registration time.
 *
 * @example
 * ```ts
 * async (uri) => ({
 *   contents: [{ uri: uri.href, mimeType: "text/plain", text: "hello" }],
 * })
 * ```
 */
export type ResourceCallback<
  TUser = never,
  HasOAuth extends boolean = false,
  TEnv extends Env = Env,
> = (
  uri: URL,
  ctx: RequestContext<TUser, HasOAuth, TEnv>
) =>
  | ReadResourceResult
  | CallToolResult
  | Promise<ReadResourceResult | CallToolResult>;

/**
 * A resource-template variable completer accepted by
 * {@link MCPServer.resourceTemplate}.
 *
 * Static values are matched case-insensitively against the beginning of the
 * current value. Callback completions use the official SDK callback shape and
 * may inspect the other resolved string arguments in its optional context.
 * The SDK limits wire results to 100 values and derives `total` and `hasMore`
 * from the returned array.
 */
export type ResourceTemplateCompleter =
  | readonly string[]
  | CompleteResourceTemplateCallback;

/**
 * Per-variable completion map inferred from an RFC 6570 URI template.
 *
 * Literal templates accept only variables declared by the template. A
 * widened `string` template accepts arbitrary string keys because its
 * variables cannot be known at compile time.
 *
 * @typeParam TUriTemplate - URI template whose variables become map keys.
 */
export type ResourceTemplateCompletions<TUriTemplate extends string> =
  string extends TUriTemplate
    ? Partial<Record<string, ResourceTemplateCompleter>>
    : Partial<
        Record<
          ExtractTemplateVariables<TUriTemplate>,
          ResourceTemplateCompleter
        >
      >;

/**
 * Declares a parameterized resource matched by URI template.
 *
 * @typeParam TUriTemplate - Literal URI template used to infer read variables
 * and completion keys.
 */
export interface ResourceTemplateDefinition<
  TUriTemplate extends string = string,
> {
  /** Template display name. */
  name: string;
  /** RFC 6570 URI template with variables, e.g. `"db://users/{id}"`. */
  uriTemplate: TUriTemplate;
  /** Human-readable title (falls back to `name`). */
  title?: string;
  /** Human-readable description. */
  description?: string;
  /** MIME type of the content. */
  mimeType?: string;
  /** Standard MCP hints describing resources produced by this template. */
  annotations?: Annotations;
  /**
   * Extension metadata advertised on this template's
   * `resources/templates/list` descriptor. Use vendor-namespaced keys for
   * custom data.
   *
   * This value is not copied into `resources/read` content entries; content
   * metadata must be returned by the callback on each entry's own `_meta`.
   */
  _meta?: MetaObject;
  /**
   * Optional completion providers keyed by URI-template variable.
   *
   * Static arrays use case-insensitive prefix matching. Dynamic callbacks may
   * be synchronous or asynchronous and receive the current value plus the
   * official completion context containing already-resolved arguments.
   */
  complete?: ResourceTemplateCompletions<TUriTemplate>;
}

/** Strip a leading RFC 6570 operator (`+`, `#`, `.`, `/`, `;`, `?`, `&`) from a template expression. */
type StripOperator<E extends string> = E extends `${
  | "+"
  | "#"
  | "."
  | "/"
  | ";"
  | "?"
  | "&"}${infer Rest}`
  ? Rest
  : E;

/** Strip a trailing RFC 6570 modifier (`*` explode, `:n` prefix) from a variable name. */
type StripModifier<V extends string> = V extends `${infer Name}*`
  ? Name
  : V extends `${infer Name}:${string}`
    ? Name
    : V;

/** Split an expression's comma-separated variable list, e.g. `"x,y"` → `"x" | "y"`. */
type SplitVariables<E extends string> = E extends `${infer Head},${infer Rest}`
  ? StripModifier<Head> | SplitVariables<Rest>
  : StripModifier<E>;

/** Union of variable names in a URI template string, e.g. `"db://{a}/{x,y*}"` → `"a" | "x" | "y"`. */
type ExtractTemplateVariables<T extends string> =
  T extends `${string}{${infer Expr}}${infer Rest}`
    ? SplitVariables<StripOperator<Expr>> | ExtractTemplateVariables<Rest>
    : never;

/** Values extracted for a single template variable. */
export type TemplateVariableValue = string | string[];

/**
 * Infer the `params` type from a definition's `uriTemplate` string literal,
 * e.g. `"db://users/{id}"` → `{ id: string | string[] }`.
 */
export type InferTemplateParams<T> = T extends {
  uriTemplate: infer U extends string;
}
  ? string extends U
    ? Record<string, TemplateVariableValue>
    : { [K in ExtractTemplateVariables<U>]: TemplateVariableValue }
  : Record<string, TemplateVariableValue>;

/**
 * Resource template read callback; receives the matched URI and variables.
 *
 * Prefer {@link ReadResourceResult}. Deprecated helper-shaped
 * {@link CallToolResult} returns are still accepted and converted.
 */
export type ResourceTemplateCallback<
  TParams = Record<string, TemplateVariableValue>,
  TUser = never,
  HasOAuth extends boolean = false,
  TEnv extends Env = Env,
> = (
  uri: URL,
  params: TParams,
  ctx: RequestContext<TUser, HasOAuth, TEnv>
) =>
  | ReadResourceResult
  | CallToolResult
  | Promise<ReadResourceResult | CallToolResult>;
