/**
 * Hono Proxy Utilities
 *
 * Utilities for creating proxied instances that allow direct access to Hono methods
 * while preserving server functionality.
 */

import type { Hono as HonoType, MiddlewareHandler } from "hono";
import {
  adaptConnectMiddleware,
  isExpressMiddleware,
} from "../connect-adapter.js";
import type { McpMiddlewareFn } from "../middleware/mcp-middleware.js";

/**
 * Express/Connect middleware signature
 * (req, res, next) => void or (err, req, res, next) => void
 */
type ExpressMiddleware = (
  req: any,
  res: any,
  next: () => void
) => void | Promise<void>;

/**
 * Express error middleware signature
 * (err, req, res, next) => void
 */
type ExpressErrorMiddleware = (
  err: any,
  req: any,
  res: any,
  next: () => void
) => void | Promise<void>;

/**
 * Union type for all acceptable middleware types
 */
type AcceptableMiddleware =
  | MiddlewareHandler
  | ExpressMiddleware
  | ExpressErrorMiddleware;

/**
 * Create a proxy that allows direct access to Hono methods
 *
 * Creates a Proxy wrapper that:
 * - Auto-detects and adapts Express middleware to Hono
 * - Proxies all Hono methods to the underlying app
 * - Preserves the target instance's own methods and properties
 *
 * @param target - The target instance to proxy
 * @param app - The Hono app instance
 * @returns Proxied instance with both target and Hono methods
 */
// HTTP methods that support HMR-able custom route registration
const HMR_HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "all",
]);

/**
 * Install a single early middleware on the Hono app that dispatches
 * custom route handlers from the mutable _customRoutes map.
 * This is called once at server startup so we never need to add
 * routes to Hono after the matcher is built (which would fail in Hono v4+).
 */
export function installCustomRoutesMiddleware(
  app: HonoType,

  customRoutes: Map<string, ((...args: any[]) => any)[]>
): void {
  // Register a single catch-all middleware that checks the custom routes map
  // Must use `all` to match any HTTP method
  app.all("*", async (c: any, next: any) => {
    const method = c.req.method.toLowerCase();
    const path = c.req.path;

    // Check for exact match: "get:/api/fruits"
    const key = `${method}:${path}`;
    const allKey = `all:${path}`;

    const handlers = customRoutes.get(key) || customRoutes.get(allKey);
    if (handlers && handlers.length > 0) {
      return handlers[handlers.length - 1](c, next);
    }

    // No match — let other handlers process the request
    return next();
  });
}

/**
 * Typed overload for MCP operation-level middleware registered via `server.use('mcp:...', fn)`.
 * Exported so `McpServerInstance` can include it, giving callers automatic type inference
 * for `ctx` and `next` without explicit annotations.
 */
export type WithMcpUse = {
  use(pattern: `mcp:${string}`, ...handlers: McpMiddlewareFn[]): any;
};

/**
 * Extended Hono type that accepts both Hono and Express middleware in use() method.
 * The `mcp:` overload must come first so TypeScript picks it before the generic
 * string overload when a literal like "mcp:tools/call" is passed.
 */
type ExtendedHonoUse = WithMcpUse & {
  use(...handlers: AcceptableMiddleware[]): any;
  use(path: string, ...handlers: AcceptableMiddleware[]): any;
};

/**
 * Type that extends Hono with Express middleware support
 */
type HonoWithExpressMiddleware = Omit<HonoType, "use"> & ExtendedHonoUse;

export function createHonoProxy<T extends object>(
  target: T,
  app: HonoType
): T & HonoWithExpressMiddleware {
  return new Proxy(target, {
    get(target, prop) {
      // Special handling for 'use' method to auto-detect and adapt Express middleware
      if (prop === "use") {
        return async (
          ...args: AcceptableMiddleware[] | [string, ...AcceptableMiddleware[]]
        ) => {
          // Hono's use signature: use(path?, ...handlers)
          // Check if the first arg is a path (string) or a handler (function)
          const hasPath = typeof args[0] === "string";

          // MCP middleware: string starting with 'mcp:' routes to the MCP middleware
          // registry on the target (MCPServerClass), not to Hono.
          if (hasPath && (args[0] as string).startsWith("mcp:")) {
            const pattern = (args[0] as string).slice(4); // strip 'mcp:'
            const handlers = args.slice(1) as ((...a: any[]) => any)[];
            if (typeof (target as any)._registerMcpMiddleware === "function") {
              for (const h of handlers) {
                (target as any)._registerMcpMiddleware(pattern, h);
              }
            }
            return target;
          }

          const path: string = hasPath ? (args[0] as string) : "*";
          const handlers: AcceptableMiddleware[] = hasPath
            ? (args.slice(1) as AcceptableMiddleware[])
            : (args as AcceptableMiddleware[]);

          // Adapt each handler if it's Express middleware
          const adaptedHandlers = handlers.map((handler: any) => {
            if (isExpressMiddleware(handler)) {
              // Return a promise-wrapped adapter since adaptConnectMiddleware is async
              // We'll handle this in the actual app.use call
              return { __isExpressMiddleware: true, handler, path };
            }
            return handler;
          });

          // Check if we have any Express middleware to adapt
          const hasExpressMiddleware = adaptedHandlers.some(
            (h: any) => h.__isExpressMiddleware
          );

          if (hasExpressMiddleware) {
            // We need to handle async adaptation
            // Await the adaptation to ensure middleware is registered before proceeding
            await Promise.all(
              adaptedHandlers.map(async (h: any) => {
                if (h.__isExpressMiddleware) {
                  const adapted = await adaptConnectMiddleware(
                    h.handler,
                    h.path
                  );
                  // Call app.use with the adapted middleware
                  if (hasPath) {
                    app.use(path, adapted);
                  } else {
                    app.use(adapted);
                  }
                } else {
                  // Regular Hono middleware
                  if (hasPath) {
                    app.use(path, h as MiddlewareHandler);
                  } else {
                    app.use(h as MiddlewareHandler);
                  }
                }
              })
            );

            return target;
          }

          // No Express middleware, call normally
          if (hasPath) {
            return app.use(path, ...(handlers as MiddlewareHandler[]));
          } else {
            return app.use(...(handlers as MiddlewareHandler[]));
          }
        };
      }

      // HMR-able HTTP route methods (get, post, put, delete, patch, all)
      // Instead of registering directly on Hono (immutable routes after first request),
      // we store handlers in a mutable map. A single early middleware installed at
      // server startup dispatches from this map at request time.
      // See: https://github.com/honojs/hono/issues/3817
      if (typeof prop === "string" && HMR_HTTP_METHODS.has(prop)) {
        return (path: string, ...handlers: ((...args: any[]) => any)[]) => {
          const customRoutes = (target as any)._customRoutes as
            | Map<string, ((...args: any[]) => any)[]>
            | undefined;

          // If the target doesn't have HMR route support, fall through to Hono directly
          if (!customRoutes) {
            return (app as any)[prop](path, ...handlers);
          }

          const key = `${prop}:${path}`;
          // Store handlers in the mutable map — the middleware reads from this at request time
          customRoutes.set(key, handlers);

          return target;
        };
      }

      if (prop in target) {
        return (target as any)[prop];
      }
      const value = (app as any)[prop];
      return typeof value === "function" ? value.bind(app) : value;
    },
  }) as T & HonoWithExpressMiddleware;
}
