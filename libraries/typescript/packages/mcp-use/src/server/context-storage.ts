/**
 * AsyncLocalStorage-based context management for HTTP requests
 * 
 * This module provides a way to pass HTTP request context (Hono Context)
 * through async call chains without explicit parameter passing.
 * 
 * This is particularly useful for:
 * - Passing authentication info from middleware to tool callbacks
 * - Accessing request headers, user data, etc. in deeply nested functions
 * - Maintaining request isolation in concurrent request handling
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "hono";

/**
 * AsyncLocalStorage instance for storing Hono request context
 * Each async operation chain maintains its own isolated context
 */
const requestContextStorage = new AsyncLocalStorage<Context>();

/**
 * Execute a function with a request context stored in AsyncLocalStorage
 * 
 * @param context - Hono Context object to store
 * @param fn - Function to execute within this context
 * @returns Promise resolving to the function's return value
 * 
 * @example
 * ```typescript
 * app.post('/mcp', async (c) => {
 *   return runWithContext(c, async () => {
 *     // Any async operations here can access context via getRequestContext()
 *     await handleMcpRequest();
 *     return c.json({ success: true });
 *   });
 * });
 * ```
 */
export async function runWithContext<T>(
  context: Context,
  fn: () => Promise<T>
): Promise<T> {
  return requestContextStorage.run(context, fn);
}

/**
 * Get the current request context from AsyncLocalStorage
 * 
 * @returns The Hono Context for the current async operation, or undefined if not in a request context
 * 
 * @example
 * ```typescript
 * // Inside a tool callback
 * const context = getRequestContext();
 * if (context) {
 *   const user = context.get('user');
 *   console.log('Current user:', user);
 * }
 * ```
 */
export function getRequestContext(): Context | undefined {
  return requestContextStorage.getStore();
}

/**
 * Check if currently executing within a request context
 * 
 * @returns true if a request context is available
 */
export function hasRequestContext(): boolean {
  return requestContextStorage.getStore() !== undefined;
}

