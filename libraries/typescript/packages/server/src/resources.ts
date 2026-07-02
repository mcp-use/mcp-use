import type { ReadResourceResult } from "@modelcontextprotocol/server";

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
}

/**
 * Resource read callback. Returns the SDK's raw {@link ReadResourceResult};
 * each `contents` entry addresses itself with the read `uri`.
 *
 * @example
 * ```ts
 * async (uri) => ({
 *   contents: [{ uri: uri.href, mimeType: "text/plain", text: "hello" }],
 * })
 * ```
 */
export type ResourceCallback = (
  uri: URL,
  ctx: RequestContext
) => ReadResourceResult | Promise<ReadResourceResult>;

/** Declares a parameterized resource matched by URI template. First argument to {@link MCPServer.resourceTemplate}. */
export interface ResourceTemplateDefinition {
  /** Template display name. */
  name: string;
  /** RFC 6570 URI template with variables, e.g. `"db://users/{id}"`. */
  uriTemplate: string;
  /** Human-readable title (falls back to `name`). */
  title?: string;
  /** Human-readable description. */
  description?: string;
  /** MIME type of the content. */
  mimeType?: string;
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

/** Resource template read callback; receives the matched URI and variables. */
export type ResourceTemplateCallback<
  TParams = Record<string, TemplateVariableValue>,
> = (
  uri: URL,
  params: TParams,
  ctx: RequestContext
) => ReadResourceResult | Promise<ReadResourceResult>;
