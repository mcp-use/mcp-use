import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import './types.js';

export interface OIDCConfig {
  /** OIDC issuer URL (e.g., https://your-tenant.auth0.com) */
  issuer: string;
  /** API audience / client ID */
  audience: string;
  /** Optional: Required scopes for access */
  requiredScopes?: string[];
}

// Cache JWKS clients per issuer
const jwksClients: Map<string, jwksClient.JwksClient> = new Map();

function getJWKSClient(jwksUri: string): jwksClient.JwksClient {
  if (!jwksClients.has(jwksUri)) {
    jwksClients.set(jwksUri, jwksClient({
      jwksUri,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 10
    }));
  }
  return jwksClients.get(jwksUri)!;
}

async function getPublicKey(header: jwt.JwtHeader, issuer: string): Promise<string> {
  if (!header.kid) {
    throw new Error('JWT header missing kid (key ID)');
  }

  // Use OpenID Connect Discovery to get JWKS URI
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  
  try {
    const response = await fetch(discoveryUrl);
    if (!response.ok) {
      throw new Error(`OIDC discovery failed: ${response.status} ${response.statusText}`);
    }
    
    const config = await response.json() as { jwks_uri: string };
    
    if (!config.jwks_uri) {
      throw new Error('JWKS URI not found in OIDC discovery document');
    }
    
    const client = getJWKSClient(config.jwks_uri);
    const key = await client.getSigningKey(header.kid);
    return key.getPublicKey();
  } catch (error) {
    throw new Error(
      `Failed to get public key from ${issuer}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * OIDC JWT Authentication Middleware
 * 
 * Validates JWT tokens using OpenID Connect Discovery.
 * Works with any OIDC-compliant provider:
 * - Auth0
 * - Keycloak  
 * - Okta
 * - Azure AD
 * - Google
 * - And more
 * 
 * @param config - OIDC configuration
 * @returns Express middleware function
 * 
 * @example
 * ```typescript
 * import { createMCPServer, oidcAuthMiddleware } from 'mcp-use/server';
 * 
 * const server = createMCPServer('my-server', { version: '1.0.0' });
 * 
 * server.use(oidcAuthMiddleware({
 *   issuer: process.env.OIDC_ISSUER!,
 *   audience: process.env.OIDC_AUDIENCE!,
 *   requiredScopes: ['mcp:read', 'mcp:write']
 * }));
 * ```
 */
export function oidcAuthMiddleware(config: OIDCConfig): RequestHandler {
  // Validate configuration
  if (!config.issuer) {
    throw new Error('OIDC issuer is required');
  }
  if (!config.audience) {
    throw new Error('OIDC audience is required');
  }

  // Normalize issuer (remove trailing slash)
  const issuer = config.issuer.replace(/\/$/, '');

  return async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      // Return WWW-Authenticate header per RFC 6750
      const scopeList = config.requiredScopes?.join(' ') || '';
      const wwwAuth = scopeList 
        ? `Bearer realm="${issuer}", scope="${scopeList}"`
        : `Bearer realm="${issuer}"`;

      return res.status(401)
        .header('WWW-Authenticate', wwwAuth)
        .json({
          error: 'missing_token',
          error_description: 'Missing Authorization header with Bearer token',
          error_uri: `${issuer}/.well-known/openid-configuration`
        });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');

    try {
      // Decode token without verification first to validate format
      const decoded = jwt.decode(token, { complete: true });
      
      if (!decoded || typeof decoded === 'string') {
        return res.status(401)
          .header('WWW-Authenticate', `Bearer realm="${issuer}", error="invalid_token"`)
          .json({
            error: 'invalid_token',
            error_description: 'Invalid JWT token format'
          });
      }

      const { header, payload } = decoded;
      const tokenIssuer = (payload as jwt.JwtPayload).iss;

      if (!tokenIssuer) {
        return res.status(401)
          .header('WWW-Authenticate', `Bearer realm="${issuer}", error="invalid_token"`)
          .json({
            error: 'invalid_token',
            error_description: 'JWT token missing issuer (iss) claim'
          });
      }

      // Verify issuer matches configuration
      if (tokenIssuer !== issuer) {
        return res.status(401)
          .header('WWW-Authenticate', `Bearer realm="${issuer}", error="invalid_token"`)
          .json({
            error: 'invalid_token',
            error_description: 'Token issuer does not match',
            expected: issuer,
            received: tokenIssuer,
            hint: 'Token must be from the configured OIDC provider'
          });
      }

      // Get public key using OIDC discovery
      const publicKey = await getPublicKey(header, issuer);
      
      // Verify token signature and claims
      const verified = jwt.verify(token, publicKey, {
        audience: config.audience,
        issuer: issuer,
        algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']
      }) as jwt.JwtPayload;

      // Extract scopes from token (different providers use different claim names)
      const scopes = verified.scope?.split(' ') || 
                     verified.scopes || 
                     verified.scp?.split(' ') || 
                     [];

      // Check required scopes
      if (config.requiredScopes && config.requiredScopes.length > 0) {
        const hasRequiredScopes = config.requiredScopes.every(required =>
          scopes.includes(required)
        );

        if (!hasRequiredScopes) {
          const scopeList = config.requiredScopes.join(' ');
          return res.status(403)
            .header('WWW-Authenticate', `Bearer realm="${issuer}", error="insufficient_scope", scope="${scopeList}"`)
            .json({
              error: 'insufficient_scope',
              error_description: 'Token does not have required scopes',
              required_scopes: config.requiredScopes,
              token_scopes: scopes
            });
        }
      }

      // Store user info and scopes in request for tools to access
      req.user = verified;
      req.scopes = scopes;
      
      console.log(`[AUTH] Authenticated user: ${verified.email || verified.sub} (scopes: ${scopes.join(', ')})`);
      next();
      
    } catch (error) {
      console.error('[AUTH] Token verification failed:', error);
      
      let errorCode = 'invalid_token';
      let errorDescription = 'Token verification failed';
      
      if (error instanceof jwt.TokenExpiredError) {
        errorCode = 'invalid_token';
        errorDescription = 'Token has expired';
      } else if (error instanceof jwt.JsonWebTokenError) {
        errorDescription = error.message;
      } else if (error instanceof Error) {
        errorDescription = error.message;
      }
      
      return res.status(401)
        .header('WWW-Authenticate', `Bearer realm="${issuer}", error="${errorCode}"`)
        .json({
          error: errorCode,
          error_description: errorDescription
        });
    }
  };
}

/**
 * Simple Bearer Token Authentication Middleware
 * 
 * For simple API key / bearer token authentication without OIDC.
 * 
 * @param validateToken - Function that validates the token and returns user info
 * @returns Express middleware function
 * 
 * @example
 * ```typescript
 * import { createMCPServer, bearerAuthMiddleware } from 'mcp-use/server';
 * 
 * const server = createMCPServer('my-server', { version: '1.0.0' });
 * 
 * server.use(bearerAuthMiddleware(async (token) => {
 *   if (token === process.env.API_KEY) {
 *     return { userId: 'admin', roles: ['admin'] };
 *   }
 *   throw new Error('Invalid API key');
 * }));
 * ```
 */
export function bearerAuthMiddleware(
  validateToken: (token: string) => Promise<{ userId: string; [key: string]: any }>
): RequestHandler {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: 'missing_token',
        error_description: 'Missing Authorization header',
        hint: 'Include header: Authorization: Bearer YOUR_TOKEN'
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!token) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Invalid Authorization header format'
      });
    }

    try {
      const user = await validateToken(token);
      
      // Store user info in request for tools to access
      req.user = user;
      
      console.log(`[AUTH] Authenticated user: ${user.userId}`);
      next();
    } catch (error) {
      console.error('[AUTH] Token validation failed:', error);
      
      return res.status(401).json({
        error: 'invalid_token',
        error_description: error instanceof Error ? error.message : 'Invalid token'
      });
    }
  };
}

