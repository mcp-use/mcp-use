/**
 * OAuth Middleware
 *
 * Creates bearer authentication middleware for Hono that validates
 * JWT tokens and attaches user information to the request context.
 */

import type { Context, Next } from "hono";
import type { OAuthProvider, OAuthProxy } from "./providers/types.js";

/**
 * Options for {@link createBearerAuthMiddleware}.
 */
export interface BearerAuthMiddlewareOptions {
  /**
   * When `true`, the middleware does **not** reject requests that arrive without
   * an `Authorization` header — it just lets them through with no auth context
   * attached. Tokens that *are* sent are still verified, and invalid tokens are
   * still rejected with 401.
   *
   * This is the SEP-1488 / OpenAI Apps SDK mixed-auth model: any tool advertising
   * `{ type: "noauth" }` in its `securitySchemes` must be reachable anonymously,
   * so the transport must accept anonymous requests and let the tool handler
   * decide (via `authenticationRequired()`) whether to issue a challenge.
   *
   * @default false
   */
  optional?: boolean;
}

/**
 * Create bearer authentication middleware for a given OAuth provider or proxy
 *
 * @param oauth - The OAuth provider or proxy to use for token verification
 * @param baseUrl - The base URL of the server (for WWW-Authenticate header)
 * @param options - Middleware options (see {@link BearerAuthMiddlewareOptions})
 * @returns Hono middleware function
 */
export function createBearerAuthMiddleware(
  oauth: OAuthProvider | OAuthProxy,
  baseUrl?: string,
  options?: BearerAuthMiddlewareOptions
) {
  const optional = options?.optional === true;

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
      // In optional mode (SEP-1488 mixed auth), missing tokens are allowed
      // through with no auth context. Tools that need auth gate themselves
      // by returning authenticationRequired().
      if (optional) {
        return next();
      }
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
      console.error("[OAuth Middleware] Token verification failed:", error);
      c.header("WWW-Authenticate", getWWWAuthenticateHeader());
      return c.json({ error: "Invalid token" }, 401);
    }
  };
}
