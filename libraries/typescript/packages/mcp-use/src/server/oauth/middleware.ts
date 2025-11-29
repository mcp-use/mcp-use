/**
 * OAuth Middleware
 * 
 * Creates bearer authentication middleware for Hono that validates
 * JWT tokens and attaches user information to the request context.
 */

import type { Context, Next } from 'hono';
import type { OAuthProvider } from './providers/types.js';

/**
 * Create bearer authentication middleware for a given OAuth provider
 * 
 * @param provider - The OAuth provider to use for token verification
 * @param baseUrl - The base URL of the server (for WWW-Authenticate header)
 * @returns Hono middleware function
 */
export function createBearerAuthMiddleware(provider: OAuthProvider, baseUrl?: string) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');

    // Build WWW-Authenticate header for 401 responses
    // This enables MCP clients to discover the OAuth configuration
    const getWWWAuthenticateHeader = () => {
      const base = baseUrl || new URL(c.req.url).origin;
      const parts = [
        'Bearer error="unauthorized"',
        'error_description="Authorization needed"',
      ];
      
      // Add resource_metadata for OAuth discovery (MCP spec)
      parts.push(`resource_metadata="${base}/.well-known/oauth-protected-resource"`);
      
      return parts.join(', ');
    };

    if (!authHeader) {
      c.header('WWW-Authenticate', getWWWAuthenticateHeader());
      return c.json({ error: 'Missing Authorization header' }, 401);
    }

    const [type, token] = authHeader.split(' ');
    if (type.toLowerCase() !== 'bearer' || !token) {
      c.header('WWW-Authenticate', getWWWAuthenticateHeader());
      return c.json(
        { error: 'Invalid Authorization header format, expected "Bearer TOKEN"' },
        401
      );
    }

    try {
      // Verify token using provider
      const result = await provider.verifyToken(token);
      const payload = result.payload;
      
      // Extract user info from payload
      const user = provider.getUserInfo(payload);

      // Create complete auth object
      const authInfo = {
        user,
        payload,
        accessToken: token,
        // Extract scopes from scope claim (OAuth standard)
        scopes: payload.scope ? payload.scope.split(' ') : [],
        // Extract permissions (Auth0 style, or custom)
        permissions: payload.permissions || [],
      };

      // Attach to context in multiple ways for maximum compatibility:
      // 1. Set in Hono's variable storage (accessible via c.get('auth'))
      c.set('auth', authInfo);
      
      // 2. Set as direct property for destructuring support ({auth} in tool callbacks)
      (c as any).auth = authInfo;

      // Also set individual properties for backward compatibility
      c.set('user', user);
      c.set('payload', payload);
      c.set('accessToken', token);

      await next();
    } catch (error) {
      c.header('WWW-Authenticate', getWWWAuthenticateHeader());
      return c.json({ error: `Invalid token: ${error}` }, 401);
    }
  };
}

