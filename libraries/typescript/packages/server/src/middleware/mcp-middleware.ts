import {
  CallToolResultSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
} from "@modelcontextprotocol/core";
import { isInputRequiredResult } from "@modelcontextprotocol/server";
import type {
  AuthInfo,
  HandlerResultTypeMap,
  RequestTypeMap,
  ResultTypeMap,
} from "@modelcontextprotocol/server";
import type { Context, Env, HonoRequest } from "hono";

const MCP_MIDDLEWARE_METHODS = [
  "tools/call",
  "tools/list",
  "resources/read",
  "resources/list",
  "prompts/get",
  "prompts/list",
] as const;

/** MCP methods currently intercepted by {@link MCPServer.use}. */
export type McpMiddlewareMethod = (typeof MCP_MIDDLEWARE_METHODS)[number];

/** Params exposed by the SDK for a particular MCP request method. */
export type McpMiddlewareParams<M extends McpMiddlewareMethod> =
  RequestTypeMap[M] extends { params?: infer P }
    ? NonNullable<P>
    : Record<string, never>;

/**
 * Method-specific params and middleware result types.
 *
 * List middleware intentionally operates on item arrays rather than protocol
 * result envelopes. The server wrapper preserves the envelope around the
 * transformed array.
 */
export interface McpMiddlewareOperationMap {
  /** Tool invocation parameters and handler result. */
  "tools/call": {
    /** Parameters for the tool invocation. */
    params: McpMiddlewareParams<"tools/call">;
    /** Tool invocation result passed through the middleware chain. */
    result: HandlerResultTypeMap["tools/call"];
  };
  /** Tool-list parameters and list items. */
  "tools/list": {
    /** Parameters for the tool-list request. */
    params: McpMiddlewareParams<"tools/list">;
    /** Tool descriptors returned by the list request. */
    result: ResultTypeMap["tools/list"]["tools"];
  };
  /** Resource-read parameters and handler result. */
  "resources/read": {
    /** Parameters identifying the resource to read. */
    params: McpMiddlewareParams<"resources/read">;
    /** Resource contents returned by the handler. */
    result: HandlerResultTypeMap["resources/read"];
  };
  /** Resource-list parameters and list items. */
  "resources/list": {
    /** Parameters for the resource-list request. */
    params: McpMiddlewareParams<"resources/list">;
    /** Resource descriptors returned by the list request. */
    result: ResultTypeMap["resources/list"]["resources"];
  };
  /** Prompt-read parameters and handler result. */
  "prompts/get": {
    /** Parameters identifying the prompt and its arguments. */
    params: McpMiddlewareParams<"prompts/get">;
    /** Prompt messages returned by the handler. */
    result: HandlerResultTypeMap["prompts/get"];
  };
  /** Prompt-list parameters and list items. */
  "prompts/list": {
    /** Parameters for the prompt-list request. */
    params: McpMiddlewareParams<"prompts/list">;
    /** Prompt descriptors returned by the list request. */
    result: ResultTypeMap["prompts/list"]["prompts"];
  };
}

/** Result exposed to middleware for a particular MCP method. */
export type McpMiddlewareResult<M extends McpMiddlewareMethod> =
  McpMiddlewareOperationMap[M]["result"];

/**
 * Rebuild an SDK request with the params currently held by middleware.
 *
 * Middleware may replace `ctx.params`, so forwarding the request object that
 * was captured before the chain ran would silently discard that replacement.
 * @internal
 */
export function withMcpMiddlewareParams<M extends McpMiddlewareMethod>(
  request: unknown,
  params: McpMiddlewareOperationMap[M]["params"]
): RequestTypeMap[M] {
  if (
    typeof request !== "object" ||
    request === null ||
    Array.isArray(request)
  ) {
    throw new TypeError(
      "[mcp-use] MCP middleware received an invalid downstream request"
    );
  }

  return { ...request, params } as RequestTypeMap[M];
}

type MiddlewareContextCommon<TEnv extends Env = Env> = Omit<
  Context<TEnv>,
  "req"
> & {
  /** Hono request for the originating HTTP exchange. */
  request?: HonoRequest;
  /**
   * Deprecated v1-compatible alias for {@link MiddlewareContext.request}.
   *
   * @deprecated Use `request` instead.
   */
  req?: HonoRequest;
  /** Session info when the underlying transport provides a session ID. */
  session?: { sessionId: string };
  /** OAuth info extracted from the validated access token. */
  auth?: AuthInfo;
  /** Shared state for middleware participating in this request. */
  state: Map<string, unknown>;
};

/**
 * Context passed to MCP middleware.
 *
 * The conditional form preserves the correlation between `method` and
 * `params` when more than one method is represented.
 */
export type MiddlewareContext<
  M extends McpMiddlewareMethod = McpMiddlewareMethod,
  TEnv extends Env = Env,
> = M extends McpMiddlewareMethod
  ? MiddlewareContextCommon<TEnv> & {
      method: M;
      params: McpMiddlewareOperationMap[M]["params"];
    }
  : never;

/** Preferred explicit name for the method-correlated middleware context. */
export type McpMiddlewareContext<
  M extends McpMiddlewareMethod = McpMiddlewareMethod,
  TEnv extends Env = Env,
> = MiddlewareContext<M, TEnv>;

/** Context with narrowed params for `tools/call`. */
export type ToolsCallMiddlewareContext = MiddlewareContext<"tools/call">;
/** Context with narrowed params for `tools/list`. */
export type ToolsListMiddlewareContext = MiddlewareContext<"tools/list">;
/** Context with narrowed params for `resources/read`. */
export type ResourcesReadMiddlewareContext =
  MiddlewareContext<"resources/read">;
/** Context with narrowed params for `resources/list`. */
export type ResourcesListMiddlewareContext =
  MiddlewareContext<"resources/list">;
/** Context with narrowed params for `prompts/get`. */
export type PromptsGetMiddlewareContext = MiddlewareContext<"prompts/get">;
/** Context with narrowed params for `prompts/list`. */
export type PromptsListMiddlewareContext = MiddlewareContext<"prompts/list">;

/** Map retained for compatibility and convenient indexed lookup. */
export type McpMiddlewarePatternMap<TEnv extends Env = Env> = {
  [M in McpMiddlewareMethod]: MiddlewareContext<M, TEnv>;
};

/** Continue the middleware chain with the result type for method `M`. */
export type McpMiddlewareNext<M extends McpMiddlewareMethod> = () => Promise<
  McpMiddlewareResult<M>
>;

/** Middleware for one exact MCP method. */
export type McpExactMiddlewareFn<
  M extends McpMiddlewareMethod,
  TEnv extends Env = Env,
> = (
  ctx: MiddlewareContext<M, TEnv>,
  next: McpMiddlewareNext<M>
) => Promise<McpMiddlewareResult<M>>;

/**
 * Type-preserving middleware over every wrapped MCP method.
 *
 * The global wildcard cannot inspect or replace a method-specific result. Its `next`
 * resolves after downstream middleware, and the composer propagates that
 * downstream result unchanged. It must call `next()` or throw.
 */
export type McpMiddlewareFn<
  Methods extends McpMiddlewareMethod = McpMiddlewareMethod,
  TEnv extends Env = Env,
> = (
  ctx: MiddlewareContext<Methods, TEnv>,
  next: () => Promise<void>
) => Promise<void>;

/** Exact MCP middleware methods plus the global pass-through wildcard. */
export type McpMiddlewarePatternBody = McpMiddlewareMethod | "*";

/** Canonical `mcp:` middleware patterns. */
export type McpMiddlewarePattern = `mcp:${McpMiddlewarePatternBody}`;

/** Observer patterns additionally support grouping related MCP methods. */
export type McpEventPatternBody =
  | McpMiddlewarePatternBody
  | "tools/*"
  | "resources/*"
  | "prompts/*";

type McpEventBasePattern = `mcp:${McpEventPatternBody}`;

type StripMcpPrefix<P extends string> = P extends `mcp:${infer Body}`
  ? Body
  : P;

/** Methods selected by an MCP middleware or observer pattern. */
export type McpMiddlewareMethodsForPattern<P extends string> =
  StripMcpPrefix<P> extends infer Body
    ? Body extends McpMiddlewareMethod
      ? Body
      : Body extends "tools/*"
        ? Extract<McpMiddlewareMethod, `tools/${string}`>
        : Body extends "resources/*"
          ? Extract<McpMiddlewareMethod, `resources/${string}`>
          : Body extends "prompts/*"
            ? Extract<McpMiddlewareMethod, `prompts/${string}`>
            : Body extends "*"
              ? McpMiddlewareMethod
              : never
    : never;

/** Infer an exact or type-preserving wildcard handler from pattern `P`. */
export type McpMiddlewareFnFor<
  P extends McpMiddlewarePattern,
  TEnv extends Env = Env,
> =
  StripMcpPrefix<P> extends infer Body
    ? Body extends McpMiddlewareMethod
      ? McpExactMiddlewareFn<Body, TEnv>
      : McpMiddlewareFn<McpMiddlewareMethodsForPattern<P>, TEnv>
    : never;

/**
 * Type-erased middleware adapter stored after registration.
 *
 * Exact handlers and the global wildcard are adapted to this common callable
 * shape before insertion, following the SDK's request-handler storage model.
 * @internal
 */
export interface McpMiddlewareEntry {
  pattern: string;
  handler: (
    ctx: MiddlewareContext,
    next: () => Promise<unknown>
  ) => Promise<unknown>;
}

/**
 * Adapt a public method-correlated handler for type-erased internal storage.
 *
 * The overload retains the public pattern/handler correlation. The broad
 * implementation signature is the deliberate erasure boundary, like the
 * official SDK's `setRequestHandler` implementation.
 */
export function createMcpMiddlewareEntry<
  P extends McpMiddlewarePattern,
  TEnv extends Env = Env,
>(pattern: P, handler: McpMiddlewareFnFor<P, TEnv>): McpMiddlewareEntry;
// eslint-disable-next-line no-redeclare -- implementation signature
export function createMcpMiddlewareEntry(
  pattern: McpMiddlewarePattern,
  handler: McpMiddlewareFnFor<McpMiddlewarePattern>
): McpMiddlewareEntry {
  const normalizedPattern = normalizeMcpMiddlewarePattern(pattern);
  const invoke = handler as McpMiddlewareEntry["handler"];

  if (normalizedPattern !== "*" && !isMcpMiddlewareMethod(normalizedPattern)) {
    throw new TypeError(
      `Unsupported MCP middleware pattern "${pattern}". Use an exact MCP method or "mcp:*".`
    );
  }

  if (normalizedPattern === "*") {
    return {
      pattern: normalizedPattern,
      handler: async (ctx, next) => {
        let downstreamCalled = false;
        let downstreamResult: unknown;

        await invoke(ctx, async () => {
          downstreamResult = await next();
          downstreamCalled = true;
        });

        if (!downstreamCalled) {
          throw new Error(
            `Wildcard MCP middleware "${normalizedPattern}" must call next()`
          );
        }

        return downstreamResult;
      },
    };
  }

  return {
    pattern: normalizedPattern,
    handler: (ctx, next) => invoke(ctx, next),
  };
}

/** Phase for MCP observer event listeners registered via `server.on()`. */
export type McpEventPhase = "before" | "complete";

/** Read-only observer context correlated by MCP method. */
export type ReadonlyMiddlewareContext<
  M extends McpMiddlewareMethod = McpMiddlewareMethod,
  TEnv extends Env = Env,
> = TEnv extends Env
  ? M extends McpMiddlewareMethod
    ? {
        readonly method: M;
        readonly params: Readonly<McpMiddlewareOperationMap[M]["params"]>;
        readonly request?: HonoRequest;
        /** @deprecated Use `request` instead. */
        readonly req?: HonoRequest;
        readonly session?: Readonly<{ sessionId: string }>;
        readonly auth?: Readonly<AuthInfo>;
        readonly state: ReadonlyMap<string, unknown>;
      }
    : never
  : never;

/** Read-only observer invoked before an MCP handler runs. */
export type McpEventListenerFn<
  Methods extends McpMiddlewareMethod = McpMiddlewareMethod,
  TEnv extends Env = Env,
> = <M extends Methods>(ctx: ReadonlyMiddlewareContext<M, TEnv>) => void;

/** Read-only observer invoked after an MCP handler completes. */
export type McpCompleteEventListenerFn<
  Methods extends McpMiddlewareMethod = McpMiddlewareMethod,
  TEnv extends Env = Env,
> = <M extends Methods>(
  ctx: ReadonlyMiddlewareContext<M, TEnv>,
  result: McpMiddlewareResult<M>
) => void;

type McpExactEventListenerFn<
  M extends McpMiddlewareMethod,
  TEnv extends Env = Env,
> = (ctx: ReadonlyMiddlewareContext<M, TEnv>) => void;

type McpExactCompleteEventListenerFn<
  M extends McpMiddlewareMethod,
  TEnv extends Env = Env,
> = (
  ctx: ReadonlyMiddlewareContext<M, TEnv>,
  result: McpMiddlewareResult<M>
) => void;

/** MCP observer pattern, optionally targeting the completion phase. */
export type McpEventPattern =
  | McpEventBasePattern
  | `${McpEventBasePattern}:complete`;

type StripCompleteSuffix<P extends string> = P extends `${infer Body}:complete`
  ? Body
  : P;

/** Infer a typed before/complete observer from event pattern `P`. */
export type McpEventListenerFnFor<
  P extends McpEventPattern,
  TEnv extends Env = Env,
> =
  StripCompleteSuffix<StripMcpPrefix<P>> extends infer Body
    ? Body extends McpMiddlewareMethod
      ? P extends `${string}:complete`
        ? McpExactCompleteEventListenerFn<Body, TEnv>
        : McpExactEventListenerFn<Body, TEnv>
      : P extends `${string}:complete`
        ? McpCompleteEventListenerFn<
            McpMiddlewareMethodsForPattern<StripCompleteSuffix<P>>,
            TEnv
          >
        : McpEventListenerFn<
            McpMiddlewareMethodsForPattern<StripCompleteSuffix<P>>,
            TEnv
          >
    : never;

/** Internal type-erased observer entry. @internal */
export interface McpEventListenerEntry {
  pattern: string;
  phase: McpEventPhase;
  handler: (ctx: ReadonlyMiddlewareContext, result?: unknown) => void;
}

/** Adapt a public method-correlated observer for type-erased storage. */
export function createMcpEventListenerEntry<
  P extends McpEventPattern,
  TEnv extends Env = Env,
>(pattern: P, handler: McpEventListenerFnFor<P, TEnv>): McpEventListenerEntry;
// eslint-disable-next-line no-redeclare -- implementation signature
export function createMcpEventListenerEntry(
  pattern: McpEventPattern,
  handler: McpEventListenerFnFor<McpEventPattern>
): McpEventListenerEntry {
  const { pattern: normalizedPattern, phase } = parseMcpPattern(pattern);
  const invoke = handler as McpEventListenerEntry["handler"];

  return {
    pattern: normalizedPattern,
    phase,
    handler: (ctx, result) => invoke(ctx, result),
  };
}

/** Test whether a registered middleware or observer pattern matches a method. */
export function matchesPattern(pattern: string, method: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return method.startsWith(prefix);
  }
  return pattern === method;
}

function isMcpMiddlewareMethod(value: string): value is McpMiddlewareMethod {
  return MCP_MIDDLEWARE_METHODS.some((method) => method === value);
}

/** Compose matching middleware in FIFO registration order. */
export function composeMiddleware<
  M extends McpMiddlewareMethod,
  TEnv extends Env = Env,
>(
  entries: McpMiddlewareEntry[],
  method: M,
  innerFn: () => Promise<McpMiddlewareResult<M>>
): (ctx: MiddlewareContext<M, TEnv>) => Promise<McpMiddlewareResult<M>> {
  const matching = entries.filter((entry) =>
    matchesPattern(entry.pattern, method)
  );

  if (matching.length === 0) {
    return (_ctx: MiddlewareContext<M, TEnv>) => innerFn();
  }

  return (ctx: MiddlewareContext<M, TEnv>) => {
    let index = -1;

    const dispatch = (i: number): Promise<McpMiddlewareResult<M>> => {
      if (i <= index) {
        return Promise.reject(new Error("next() called multiple times"));
      }
      index = i;

      if (i === matching.length) {
        return innerFn();
      }

      const entry = matching[i]!;
      return entry.handler(ctx as unknown as MiddlewareContext, () =>
        dispatch(i + 1)
      ) as Promise<McpMiddlewareResult<M>>;
    };

    return dispatch(0);
  };
}

/** Build a read-only snapshot of middleware context for observer events. */
export function freezeMiddlewareContext<
  M extends McpMiddlewareMethod,
  TEnv extends Env = Env,
>(ctx: MiddlewareContext<M, TEnv>): ReadonlyMiddlewareContext<M, TEnv> {
  return Object.freeze({
    method: ctx.method,
    params: Object.freeze({ ...ctx.params }),
    ...(ctx.request !== undefined && { request: ctx.request }),
    ...(ctx.req !== undefined && { req: ctx.req }),
    ...(ctx.session !== undefined && {
      session: Object.freeze({ ...ctx.session }),
    }),
    ...(ctx.auth !== undefined && { auth: ctx.auth }),
    state: new Map(ctx.state),
  }) as unknown as ReadonlyMiddlewareContext<M, TEnv>;
}

/** Run before/complete observers around a method-correlated middleware chain. */
export async function runMcpOperation<
  M extends McpMiddlewareMethod,
  TEnv extends Env = Env,
>(
  middlewares: McpMiddlewareEntry[],
  events: McpEventListenerEntry[],
  method: M,
  ctx: MiddlewareContext<M, TEnv>,
  innerFn: () => Promise<McpMiddlewareResult<M>>
): Promise<McpMiddlewareResult<M>> {
  dispatchMcpEvents(events, method, "before", ctx);

  const chained = composeMiddleware<M, TEnv>(middlewares, method, innerFn);
  const result = await chained(ctx);
  assertValidMiddlewareResult(method, result);

  dispatchMcpEvents(events, method, "complete", ctx, result);
  return result;
}

function assertValidMiddlewareResult<M extends McpMiddlewareMethod>(
  method: M,
  result: McpMiddlewareResult<M>
): void {
  if (
    (method === "tools/call" ||
      method === "resources/read" ||
      method === "prompts/get") &&
    isInputRequiredResult(result)
  ) {
    return;
  }

  const validation = (() => {
    switch (method) {
      case "tools/call":
        assertArrayProperty(method, result, "content");
        return CallToolResultSchema.safeParse(result);
      case "tools/list":
        assertArrayResult(method, result);
        return ListToolsResultSchema.safeParse({ tools: result });
      case "resources/read":
        assertArrayProperty(method, result, "contents");
        return ReadResourceResultSchema.safeParse(result);
      case "resources/list":
        assertArrayResult(method, result);
        return ListResourcesResultSchema.safeParse({ resources: result });
      case "prompts/get":
        assertArrayProperty(method, result, "messages");
        return GetPromptResultSchema.safeParse(result);
      case "prompts/list":
        assertArrayResult(method, result);
        return ListPromptsResultSchema.safeParse({ prompts: result });
      default:
        throw new TypeError(`Unsupported MCP middleware method "${method}"`);
    }
  })();

  if (!validation.success) {
    throw new TypeError(
      `[mcp-use] ${method} middleware returned an invalid result: ${validation.error.message}`
    );
  }
}

function assertArrayResult(
  method: string,
  result: unknown
): asserts result is unknown[] {
  if (!Array.isArray(result)) {
    throw new TypeError(
      `[mcp-use] ${method} middleware returned an invalid result: expected an array`
    );
  }
}

function assertArrayProperty(
  method: string,
  result: unknown,
  property: string
): void {
  if (
    typeof result !== "object" ||
    result === null ||
    !Array.isArray((result as Record<string, unknown>)[property])
  ) {
    throw new TypeError(
      `[mcp-use] ${method} middleware returned an invalid result: expected a ${property} array`
    );
  }
}

function dispatchMcpEvents<
  M extends McpMiddlewareMethod,
  TEnv extends Env = Env,
>(
  events: McpEventListenerEntry[],
  method: M,
  phase: McpEventPhase,
  ctx: MiddlewareContext<M, TEnv>,
  result?: McpMiddlewareResult<M>
): void {
  const frozen = freezeMiddlewareContext(ctx);
  for (const entry of events) {
    if (entry.phase !== phase || !matchesPattern(entry.pattern, method)) {
      continue;
    }
    try {
      entry.handler(frozen as unknown as ReadonlyMiddlewareContext, result);
    } catch (error) {
      console.error(
        `[mcp-use] MCP event listener for "${entry.pattern}" (${phase}) threw:`,
        error
      );
    }
  }
}

/** Strip `mcp:` prefix and optional `:complete` suffix from event patterns. */
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

/** Normalize middleware pattern strings by stripping the `mcp:` prefix. */
export function normalizeMcpMiddlewarePattern(raw: string): string {
  return raw.startsWith("mcp:") ? raw.slice(4) : raw;
}
