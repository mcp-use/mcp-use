/**
 * Hono Proxy Utilities
 *
 * Utilities for creating proxied instances that allow direct access to Hono methods
 * while preserving server functionality.
 */

import type { Hono as HonoType } from "hono";
import {
  adaptConnectMiddleware,
  isExpressMiddleware,
} from "../connect-adapter.js";

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

export function createHonoProxy<T extends object>(
  target: T,
  app: HonoType
): T & HonoType {
  return new Proxy(target, {
    get(target, prop) {
      // Special handling for 'use' method to auto-detect and adapt Express middleware
      if (prop === "use") {
        return async (...args: any[]) => {
          // Hono's use signature: use(path?, ...handlers)
          // Check if the first arg is a path (string) or a handler (function)
          const hasPath = typeof args[0] === "string";
          const path = hasPath ? args[0] : "*";
          const handlers = hasPath ? args.slice(1) : args;

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
                    (app as any).use(path, adapted);
                  } else {
                    (app as any).use(adapted);
                  }
                } else {
                  // Regular Hono middleware
                  if (hasPath) {
                    (app as any).use(path, h);
                  } else {
                    (app as any).use(h);
                  }
                }
              })
            );

            return target;
          }

          // No Express middleware, call normally
          return (app as any).use(...args);
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
  }) as T & HonoType;
}
