/**
 * OAuth Middleware
 *
 * Creates bearer authentication middleware for Hono that validates
 * JWT tokens and attaches user information to the request context.
 */

import type { Context, Next } from "hono";
import type { OAuthProvider, OAuthProxy } from "./providers/types.js";

/**
 * Create bearer authentication middleware for a given OAuth provider or proxy
 *
 * @param oauth - The OAuth provider or proxy to use for token verification
 * @param getBaseUrl - Lazy getter for the server base URL (for WWW-Authenticate header).
 *                    Called per-request so callers can defer resolution until after
 *                    the HTTP listener has bound a port.
 * @param basePath - Optional externally-visible prefix the server is mounted under
 *                   (e.g. "/api"). Used to construct the path-aware
 *                   `resource_metadata` URL per RFC 9728 §3.1, which inserts
 *                   `/.well-known/oauth-protected-resource` between host and
 *                   resource path — so the MCP endpoint at `<host><basePath>/mcp`
 *                   has metadata at `<host>/.well-known/oauth-protected-resource<basePath>/mcp`.
 * @returns Hono middleware function
 */
export function createBearerAuthMiddleware(
  oauth: OAuthProvider | OAuthProxy,
  getBaseUrl?: () => string | undefined,
  basePath: string = ""
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
      const base = getBaseUrl?.() || new URL(c.req.url).origin;
      const parts = [
        'Bearer error="unauthorized"',
        'error_description="Authorization needed"',
      ];

      // Path-aware resource_metadata URL per RFC 9728 §3.1: the metadata URL
      // is built by inserting `/.well-known/oauth-protected-resource` between
      // host and the resource path. The protected resource here is the MCP
      // transport endpoint at `<basePath>/mcp`. The matching route is
      // registered in routes.ts (`/.well-known/oauth-protected-resource<basePath>/mcp`).
      parts.push(
        `resource_metadata="${base}/.well-known/oauth-protected-resource${basePath}/mcp"`
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
      const authInfo = {
        user,
        payload,
        accessToken: token,
        // Extract scopes from scope claim (OAuth standard)
        scopes: scope ? scope.split(" ") : [],
        // Extract permissions (Auth0 style, or custom)
        permissions: (payload.permissions as string[]) || [],
      };

      // Attach to context in multiple ways for maximum compatibility:
      // 1. Set in Hono's variable storage (accessible via c.get('auth'))
      c.set("auth", authInfo);

      // 2. Set as direct property for destructuring support ({auth} in tool callbacks)
      (c as any).auth = authInfo;

      // Also set individual properties for backward compatibility
      c.set("user", user);
      c.set("payload", payload);
      c.set("accessToken", token);

      await next();
    } catch (error) {
      c.header("WWW-Authenticate", getWWWAuthenticateHeader());
      return c.json({ error: `Invalid token: ${error}` }, 401);
    }
  };
}
