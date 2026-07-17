import type { AuthInfo } from "@modelcontextprotocol/server";

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
  /** OAuth info extracted from JWT, present when OAuth is configured */
  auth?: AuthInfo;
  /** Shared state Map for passing data across middleware in the same request */
  state: Map<string, unknown>;
}

/** Params shape for `tools/call` method */
interface ToolsCallParams {
  name: string;
  arguments?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

/** Params shape for `resources/read` method */
interface ResourcesReadParams {
  uri: string;
  _meta?: Record<string, unknown>;
}

/** Params shape for `prompts/get` method */
interface PromptsGetParams {
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

/** Phase for MCP observer event listeners registered via `server.on()`. */
export type McpEventPhase = "before" | "complete";

/**
 * Internal storage entry for a registered MCP observer event listener.
 * @internal
 */
export interface McpEventListenerEntry {
  pattern: string;
  phase: McpEventPhase;
  handler: McpEventListenerFn | McpCompleteEventListenerFn;
}

/** Read-only observer invoked before the MCP handler runs. */
export type McpEventListenerFn = (ctx: Readonly<MiddlewareContext>) => void;

/** Read-only observer invoked after the MCP handler completes. */
export type McpCompleteEventListenerFn = (
  ctx: Readonly<MiddlewareContext>,
  result: unknown
) => void;

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
    const prefix = pattern.slice(0, -1);
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

      const entry = matching[i]!;
      return entry.handler(ctx, () => dispatch(i + 1));
    };

    return dispatch(0);
  };
}

/** Build a read-only snapshot of middleware context for observer events. */
export function freezeMiddlewareContext(
  ctx: MiddlewareContext
): Readonly<MiddlewareContext> {
  return Object.freeze({
    method: ctx.method,
    params: Object.freeze({ ...ctx.params }),
    ...(ctx.auth !== undefined && { auth: ctx.auth }),
    state: ctx.state,
  });
}

/**
 * Run before/complete observer listeners around a middleware chain.
 *
 * Listener throws are logged and do not fail the MCP request.
 */
export async function runMcpOperation(
  middlewares: McpMiddlewareEntry[],
  events: McpEventListenerEntry[],
  method: string,
  ctx: MiddlewareContext,
  innerFn: () => Promise<unknown>
): Promise<unknown> {
  dispatchMcpEvents(events, method, "before", ctx);

  const chained = composeMiddleware(middlewares, method, innerFn);
  const result = await chained(ctx);

  dispatchMcpEvents(events, method, "complete", ctx, result);
  return result;
}

function dispatchMcpEvents(
  events: McpEventListenerEntry[],
  method: string,
  phase: McpEventPhase,
  ctx: MiddlewareContext,
  result?: unknown
): void {
  const frozen = freezeMiddlewareContext(ctx);
  for (const entry of events) {
    if (entry.phase !== phase || !matchesPattern(entry.pattern, method)) {
      continue;
    }
    try {
      if (phase === "before") {
        (entry.handler as McpEventListenerFn)(frozen);
      } else {
        (entry.handler as McpCompleteEventListenerFn)(frozen, result);
      }
    } catch (error) {
      console.error(
        `[mcp-use] MCP event listener for "${entry.pattern}" (${phase}) threw:`,
        error
      );
    }
  }
}

/** Strip `mcp:` prefix and optional `:complete` suffix from observer patterns. */
export function parseMcpPattern(raw: string): {
  pattern: string;
  phase: McpEventPhase;
} {
  const pattern = raw.startsWith("mcp:") ? raw.slice(4) : raw;
  if (pattern.endsWith(":complete")) {
    return {
      pattern: pattern.slice(0, -":complete".length),
      phase: "complete",
    };
  }
  return { pattern, phase: "before" };
}

/** Normalize middleware pattern strings (strip `mcp:` prefix). */
export function normalizeMcpMiddlewarePattern(raw: string): string {
  return raw.startsWith("mcp:") ? raw.slice(4) : raw;
}
