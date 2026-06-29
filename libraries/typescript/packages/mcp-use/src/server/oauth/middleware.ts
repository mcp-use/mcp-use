/**
 * OAuth Middleware
 *
 * Creates bearer authentication middleware for Hono that validates
 * JWT tokens and attaches user information to the request context.
 */

import type { Context, Next } from "hono";
import type { OAuthProvider, OAuthProxy } from "./providers/types.js";
import { createAuthContext } from "./utils.js";

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value.split(" ").filter(Boolean);
  }
  return [];
}

function extractRoles(payload: Record<string, unknown>): string[] {
  const roles = new Set<string>(stringArray(payload.roles));
  const realmAccess = payload.realm_access;
  if (realmAccess && typeof realmAccess === "object") {
    for (const role of stringArray(
      (realmAccess as Record<string, unknown>).roles
    )) {
      roles.add(role);
    }
  }
  return Array.from(roles);
}

/**
 * Create bearer authentication middleware for a given OAuth provider or proxy
 *
 * @param oauth - The OAuth provider or proxy to use for token verification
 * @param baseUrl - The base URL of the server (for WWW-Authenticate header)
 * @returns Hono middleware function
 */
export function createBearerAuthMiddleware(
  oauth: OAuthProvider | OAuthProxy,
  baseUrl?: string
) {
  return async (c: Context, next: Next) => {
    // Allow HEAD requests through without auth - used for health checks/keep-alive
    if (c.req.method === "HEAD") {
      return next();
    }

    const authHeader = c.req.header("Authorization");

    // Build WWW-Authenticate header for 401 responses
    // This enables MCP clients to discover the OAuth configuration
    const getWWWAuthenticateHeader = () => {
      const base = baseUrl || new URL(c.req.url).origin;
      const parts = [
        'Bearer error="unauthorized"',
        'error_description="Authorization needed"',
      ];

      // Add resource_metadata for OAuth discovery (MCP spec)
      parts.push(
        `resource_metadata="${base}/.well-known/oauth-protected-resource"`
      );

      return parts.join(", ");
    };

    if (!authHeader) {
      c.header("WWW-Authenticate", getWWWAuthenticateHeader());
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    const [type, token] = authHeader.split(" ");
    if (type.toLowerCase() !== "bearer" || !token) {
      c.header("WWW-Authenticate", getWWWAuthenticateHeader());
      return c.json(
        {
          error: 'Invalid Authorization header format, expected "Bearer TOKEN"',
        },
        401
      );
    }

    try {
      // Verify token using provider/proxy
      const result = await oauth.verifyToken(token);
      const payload = result.payload;

      // Extract user info from payload
      const user = await oauth.getUserInfo(payload);

      // Create complete auth object
      const scope = payload.scope as string | undefined;
      const scopes = scope ? scope.split(" ") : [];
      const permissions = stringArray(payload.permissions);
      const roles = extractRoles(payload);
      const authContext = createAuthContext({
        user,
        payload,
        scopes,
        permissions,
        roles,
      });
      const authInfo = {
        user,
        payload,
        accessToken: token,
        // Extract scopes from scope claim (OAuth standard)
        scopes,
        // Extract permissions (Auth0 style, or custom)
        permissions,
        roles,
        context: authContext,
      };

      // Attach to context in multiple ways for maximum compatibility:
      // 1. Set in Hono's variable storage (accessible via c.get('auth'))
      c.set("auth", authInfo);
      c.set("authContext", authContext);

      // 2. Set as direct property for destructuring support ({auth} in tool callbacks)
      const contextWithAuth = c as Context & {
        auth?: typeof authInfo;
        authContext?: typeof authContext;
      };
      contextWithAuth.auth = authInfo;
      contextWithAuth.authContext = authContext;

      // Also set individual properties for backward compatibility
      c.set("user", user);
      c.set("payload", payload);
      c.set("accessToken", token);

      await next();
    } catch (error) {
      console.error("[OAuth Middleware] Token verification failed:", error);
      c.header("WWW-Authenticate", getWWWAuthenticateHeader());
      return c.json({ error: "Invalid token" }, 401);
    }
  };
}
