/**
 * OAuth Utility Helpers
 *
 * Provides convenience functions for scope/permission checking and
 * accessing authentication information in tool callbacks and middleware.
 */

import type { Context, Next } from "hono";

/**
 * Authentication information extracted from context
 */
export interface AuthInfo {
  user: any;
  payload: any;
  accessToken: string;
  scopes: string[];
  permissions: string[];
}

/**
 * Get authentication info from context
 *
 * Works in both middleware and tool callbacks (via requestContext parameter).
 *
 * Note: With the new API, you can access auth directly via `requestContext.auth`
 * This function is kept for backward compatibility.
 *
 * @param context - Hono context (from middleware or tool requestContext)
 * @returns Authentication information
 *
 * @example
 * ```typescript
 * // New way (preferred):
 * server.tool({
 *   name: 'my-tool',
 *   cb: async (params, ctx, requestContext) => {
 *     const auth = requestContext.auth;
 *     console.log(auth.user.email);
 *     console.log(auth.scopes);
 *   }
 * });
 *
 * // Old way (still works):
 * server.tool({
 *   name: 'my-tool',
 *   cb: async (params, ctx, req) => {
 *     const auth = getAuth(req);
 *     console.log(auth.user.email);
 *   }
 * });
 * ```
 */
export function getAuth(context: Context): AuthInfo {
  return context.get("auth") as AuthInfo;
}

/**
 * Check if user has specific scope(s) or permission(s)
 *
 * Checks both OAuth scopes and permissions (Auth0 style).
 * If multiple scopes are provided, ALL must be present.
 * Use this inside tool callbacks to check scopes and return appropriate errors.
 *
 * @param context - Hono context (from tool requestContext parameter)
 * @param needed - Single scope/permission or array of required scopes/permissions
 * @returns true if user has all required scopes/permissions
 *
 * @example
 * ```typescript
 * // Check scope inside tool callback
 * server.tool({
 *   name: 'delete-data',
 *   cb: async (params, ctx, requestContext) => {
 *     if (!hasScope(requestContext, 'delete:data')) {
 *       return {
 *         content: [{ type: 'text', text: 'Insufficient permissions' }],
 *         isError: true
 *       };
 *     }
 *     // ... tool implementation
 *   }
 * });
 *
 * // Check multiple scopes
 * if (hasScope(requestContext, ['read:data', 'write:data'])) {
 *   // User has both read:data AND write:data
 * }
 * ```
 */
export function hasScope(context: Context, needed: string | string[]): boolean {
  const { scopes, permissions } = getAuth(context);
  const requiredScopes = Array.isArray(needed) ? needed : [needed];

  // Check if ALL required scopes are present in either scopes or permissions
  return requiredScopes.every(
    (scope) => scopes.includes(scope) || permissions.includes(scope)
  );
}

/**
 * Check if user has ANY of the provided scopes/permissions
 *
 * @param context - Hono context
 * @param needed - Array of scopes/permissions (user needs at least one)
 * @returns true if user has at least one of the required scopes/permissions
 *
 * @example
 * ```typescript
 * if (hasAnyScope(req, ['admin', 'moderator'])) {
 *   // User is either an admin OR moderator
 * }
 * ```
 */
export function hasAnyScope(context: Context, needed: string[]): boolean {
  const { scopes, permissions } = getAuth(context);

  // Check if at least ONE scope is present
  return needed.some(
    (scope) => scopes.includes(scope) || permissions.includes(scope)
  );
}

/**
 * Create middleware that requires specific scope(s)/permission(s)
 *
 * Returns 403 Forbidden if user doesn't have the required scope(s).
 * If multiple scopes are provided, ALL must be present.
 * Note: For tool-level scope checking, use hasScope() inside the tool callback instead.
 *
 * @param needed - Single scope/permission or array of required scopes/permissions
 * @returns Hono middleware function
 *
 * @example
 * ```typescript
 * // Use on custom routes
 * app.post('/admin/users', requireScope('admin'), async (c) => {
 *   // Only users with 'admin' scope can access
 * });
 *
 * // Require multiple scopes on a route
 * app.delete('/data/:id', requireScope(['admin', 'delete:data']), async (c) => {
 *   // User must have both scopes
 * });
 * ```
 */
export function requireScope(needed: string | string[]) {
  return async (c: Context, next: Next) => {
    if (!hasScope(c, needed)) {
      const { scopes, permissions } = getAuth(c);
      const requiredScopes = Array.isArray(needed) ? needed : [needed];

      return c.json(
        {
          error: "insufficient_scope",
          required: requiredScopes,
          granted_scopes: scopes,
          granted_permissions: permissions,
          message: `Missing required scope(s): ${requiredScopes.join(", ")}`,
        },
        403
      );
    }
    await next();
  };
}

/**
 * Create middleware that requires ANY of the provided scopes/permissions
 *
 * Returns 403 Forbidden if user doesn't have at least one required scope.
 * Note: For tool-level scope checking, use hasAnyScope() inside the tool callback instead.
 *
 * @param needed - Array of scopes/permissions (user needs at least one)
 * @returns Hono middleware function
 *
 * @example
 * ```typescript
 * // Use on custom routes - user needs to be either admin OR moderator
 * app.post('/moderate', requireAnyScope(['admin', 'moderator']), async (c) => {
 *   // User has at least one of the required scopes
 * });
 * ```
 */
export function requireAnyScope(needed: string[]) {
  return async (c: Context, next: Next) => {
    if (!hasAnyScope(c, needed)) {
      const { scopes, permissions } = getAuth(c);

      return c.json(
        {
          error: "insufficient_scope",
          required_any: needed,
          granted_scopes: scopes,
          granted_permissions: permissions,
          message: `Missing at least one required scope from: ${needed.join(", ")}`,
        },
        403
      );
    }
    await next();
  };
}
