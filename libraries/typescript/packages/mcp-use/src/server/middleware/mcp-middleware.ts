/**
 * MCP Operation-Level Middleware
 *
 * Provides a Hono-style middleware system for intercepting MCP operations
 * (tool calls, resource reads, prompt gets, list operations) using the
 * `server.use('mcp:...', handler)` API.
 *
 * @example
 * ```typescript
 * // Log all tool calls
 * server.use('mcp:tools/call', async (ctx, next) => {
 *   console.log(`Calling tool: ${ctx.params.name}`);
 *   const result = await next();
 *   return result;
 * });
 *
 * // Catch-all: every MCP operation
 * server.use('mcp:*', async (ctx, next) => {
 *   const start = Date.now();
 *   const result = await next();
 *   console.log(`${ctx.method} took ${Date.now() - start}ms`);
 *   return result;
 * });
 * ```
 */

import type { AuthInfo } from "../oauth/utils.js";

/**
 * Context passed to every MCP middleware handler.
 *
 * `params` is mutable — middleware can modify params before calling `next()`
 * and those changes will be visible to downstream middleware and the handler.
 *
 * `state` is a shared Map for passing arbitrary data across middleware in
 * the same chain.
 */
export interface MiddlewareContext {
  /** MCP method name, e.g. "tools/call", "tools/list", "resources/read" */
  method: string;
  /** JSON-RPC request params (mutable — mutations are passed downstream) */
  params: Record<string, unknown>;
  /** Session info if available (HTTP transports only) */
  session?: { sessionId: string };
  /** OAuth info extracted from JWT, present when OAuth is configured */
  auth?: AuthInfo;
  /** Shared state Map for passing data across middleware in the same request */
  state: Map<string, unknown>;
}

/** Params shape for `tools/call` method */
export interface ToolsCallParams {
  name: string;
  arguments?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

/** Params shape for `resources/read` method */
export interface ResourcesReadParams {
  uri: string;
  _meta?: Record<string, unknown>;
}

/** Params shape for `prompts/get` method */
export interface PromptsGetParams {
  name: string;
  arguments?: Record<string, string>;
  _meta?: Record<string, unknown>;
}

/** Context with narrowed `params` for `tools/call` */
export interface ToolsCallMiddlewareContext extends MiddlewareContext {
  method: "tools/call";
  params: ToolsCallParams & Record<string, unknown>;
}

/** Context with narrowed `params` for `resources/read` */
export interface ResourcesReadMiddlewareContext extends MiddlewareContext {
  method: "resources/read";
  params: ResourcesReadParams & Record<string, unknown>;
}

/** Context with narrowed `params` for `prompts/get` */
export interface PromptsGetMiddlewareContext extends MiddlewareContext {
  method: "prompts/get";
  params: PromptsGetParams & Record<string, unknown>;
}

/**
 * Map from MCP middleware pattern strings to their narrowed context type.
 * Used by `McpMiddlewareFnFor<P>` to infer the correct `ctx` parameter.
 */
export interface McpMiddlewarePatternMap {
  "tools/call": ToolsCallMiddlewareContext;
  "resources/read": ResourcesReadMiddlewareContext;
  "prompts/get": PromptsGetMiddlewareContext;
}

/**
 * A typed MCP middleware function whose `ctx` is narrowed based on the
 * pattern string `P`. Falls back to the base `MiddlewareContext` for
 * wildcard or unrecognized patterns.
 */
export type McpMiddlewareFnFor<P extends string> =
  P extends keyof McpMiddlewarePatternMap
    ? (
        ctx: McpMiddlewarePatternMap[P],
        next: () => Promise<unknown>
      ) => Promise<unknown>
    : McpMiddlewareFn;

/**
 * A single MCP middleware function.
 *
 * Call `next()` to pass control to the next middleware (or handler).
 * Return its result, or return a different value to override the response.
 * Throw an error to reject the request.
 */
export type McpMiddlewareFn = (
  ctx: MiddlewareContext,
  next: () => Promise<unknown>
) => Promise<unknown>;

/**
 * Internal storage entry for a registered MCP middleware.
 * The pattern is stored with the `mcp:` prefix already stripped.
 * @internal
 */
export interface McpMiddlewareEntry {
  /** Pattern after stripping "mcp:" — e.g. "tools/call", "tools/*", "*" */
  pattern: string;
  handler: McpMiddlewareFn;
}

/**
 * Test whether a registered middleware pattern matches a given MCP method.
 *
 * Matching rules:
 * - `"*"` matches any method
 * - `"tools/*"` prefix-matches any method starting with `"tools/"`
 * - `"tools/call"` exact-matches only `"tools/call"`
 */
export function matchesPattern(pattern: string, method: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1); // e.g. "tools/"
    return method.startsWith(prefix);
  }
  return pattern === method;
}

/**
 * Compose a middleware chain for a given MCP method invocation.
 *
 * Filters `entries` to those matching `method`, then builds a `next()` chain
 * with `innerFn` at the center. Returns the outermost callable.
 *
 * Middleware executes in FIFO registration order (first registered = outermost).
 */
export function composeMiddleware(
  entries: McpMiddlewareEntry[],
  method: string,
  innerFn: () => Promise<unknown>
): (ctx: MiddlewareContext) => Promise<unknown> {
  const matching = entries.filter((e) => matchesPattern(e.pattern, method));

  if (matching.length === 0) {
    return (_ctx: MiddlewareContext) => innerFn();
  }

  return (ctx: MiddlewareContext) => {
    let index = -1;

    const dispatch = (i: number): Promise<unknown> => {
      if (i <= index) {
        return Promise.reject(new Error("next() called multiple times"));
      }
      index = i;

      if (i === matching.length) {
        return innerFn();
      }

      const entry = matching[i];
      return entry.handler(ctx, () => dispatch(i + 1));
    };

    return dispatch(0);
  };
}
