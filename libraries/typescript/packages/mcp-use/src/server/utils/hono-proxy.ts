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
export function createHonoProxy<T extends object>(target: T, app: HonoType): T {
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

      if (prop in target) {
        return (target as any)[prop];
      }
      const value = (app as any)[prop];
      return typeof value === "function" ? value.bind(app) : value;
    },
  }) as T;
}
