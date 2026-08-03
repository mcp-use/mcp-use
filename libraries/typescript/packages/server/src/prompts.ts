import type {
  CallToolResult,
  GetPromptResult,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type { Env } from "hono";

import type { RequestContext } from "./context.js";

/** Declares a prompt's identity and argument schema. First argument to {@link MCPServer.prompt}. */
export interface PromptDefinition {
  /** Unique prompt identifier, e.g. `"code-review"`. */
  name: string;
  /** Human-readable title (falls back to `name`). */
  title?: string;
  /** Human-readable description. */
  description?: string;
  /**
   * Object schema for prompt arguments ({@link StandardSchemaWithJSON}).
   * Fields wrapped with `completable()` gain autocomplete via
   * `completion/complete`.
   */
  schema?: StandardSchemaWithJSON;
}

/** Infer the callback params type from a prompt definition's `schema`. */
export type InferPromptInput<T> = T extends {
  schema: infer S extends StandardSchemaWithJSON;
}
  ? StandardSchemaWithJSON.InferOutput<S>
  : Record<string, unknown>;

/**
 * Prompt execution callback. Prefer the SDK's raw {@link GetPromptResult}.
 *
 * Deprecated response helpers that return a {@link CallToolResult} are still
 * accepted and converted at registration time.
 *
 * @example
 * ```ts
 * async ({ code }) => ({
 *   messages: [
 *     { role: "user", content: { type: "text", text: `Review:\n${code}` } },
 *   ],
 * })
 * ```
 */
export type PromptCallback<
  TInput = Record<string, unknown>,
  TUser = never,
  HasOAuth extends boolean = false,
  TEnv extends Env = Env,
> = (
  params: TInput,
  ctx: RequestContext<TUser, HasOAuth, TEnv>
) =>
  | GetPromptResult
  | CallToolResult
  | Promise<GetPromptResult | CallToolResult>;
