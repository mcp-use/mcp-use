import type {
  CallToolResultLike,
  Middleware,
  MiddlewareContext,
  PromptInfo,
  ResourceInfo,
  ToolInfo,
} from "../types/middleware.js";

/**
 * Builds an onion-model middleware chain for tools/list.
 * Middlewares execute in registration order: first registered = outermost.
 *
 * @param middlewares - Array of registered middlewares
 * @param baseFn - The base handler (SDK default) that returns the tool list
 * @returns A function that, given a context, runs the full chain
 */
export function buildListToolsChain(
  middlewares: Middleware[],
  baseFn: () => Promise<ToolInfo[]>
): (ctx: MiddlewareContext) => Promise<ToolInfo[]> {
  // Collect only middlewares that have onListTools
  const hooks = middlewares
    .filter((m) => m.onListTools != null)
    .map((m) => m.onListTools!);

  return (ctx: MiddlewareContext) => {
    // Build chain from inside out: last hook wraps baseFn, first hook is outermost
    let next = baseFn;
    for (let i = hooks.length - 1; i >= 0; i--) {
      const hook = hooks[i];
      const currentNext = next;
      next = () => hook(ctx, currentNext);
    }
    return next();
  };
}

/**
 * Builds an onion-model middleware chain for tools/call.
 *
 * The returned function accepts a per-request `baseFn` so that the
 * hook-filtering loop runs once at chain-construction time (per session),
 * while the base handler closure — which captures the raw SDK request/extra
 * objects — is created fresh per request.
 *
 * @param middlewares - Array of registered middlewares
 * @returns A function that, given context, params, and a base handler, runs the full chain
 */
export function buildCallToolChain(
  middlewares: Middleware[]
): (
  ctx: MiddlewareContext,
  params: { name: string; arguments?: Record<string, unknown> },
  baseFn: () => Promise<CallToolResultLike>
) => Promise<CallToolResultLike> {
  const hooks = middlewares
    .filter((m) => m.onCallTool != null)
    .map((m) => m.onCallTool!);

  return (
    ctx: MiddlewareContext,
    params: { name: string; arguments?: Record<string, unknown> },
    baseFn: () => Promise<CallToolResultLike>
  ) => {
    let next = baseFn;
    for (let i = hooks.length - 1; i >= 0; i--) {
      const hook = hooks[i];
      const currentNext = next;
      next = () => hook(ctx, params, currentNext);
    }
    return next();
  };
}

/**
 * Builds an onion-model middleware chain for prompts/list.
 */
export function buildListPromptsChain(
  middlewares: Middleware[],
  baseFn: () => Promise<PromptInfo[]>
): (ctx: MiddlewareContext) => Promise<PromptInfo[]> {
  const hooks = middlewares
    .filter((m) => m.onListPrompts != null)
    .map((m) => m.onListPrompts!);

  return (ctx: MiddlewareContext) => {
    let next = baseFn;
    for (let i = hooks.length - 1; i >= 0; i--) {
      const hook = hooks[i];
      const currentNext = next;
      next = () => hook(ctx, currentNext);
    }
    return next();
  };
}

/**
 * Builds an onion-model middleware chain for resources/list.
 */
export function buildListResourcesChain(
  middlewares: Middleware[],
  baseFn: () => Promise<ResourceInfo[]>
): (ctx: MiddlewareContext) => Promise<ResourceInfo[]> {
  const hooks = middlewares
    .filter((m) => m.onListResources != null)
    .map((m) => m.onListResources!);

  return (ctx: MiddlewareContext) => {
    let next = baseFn;
    for (let i = hooks.length - 1; i >= 0; i--) {
      const hook = hooks[i];
      const currentNext = next;
      next = () => hook(ctx, currentNext);
    }
    return next();
  };
}
