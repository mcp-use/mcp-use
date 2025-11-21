# Authentication Implementation Summary

## Overview

Implemented comprehensive server-side authentication for MCP servers with PR #427 fixes and new examples.

## Fixes Applied to PR #427

### 1. Array Type Restriction (FIXED)
**Issue:** Changed `z.array(z.any())` to `z.array(z.string())` - breaking change  
**Fix:** Reverted to `z.array(z.any())` in `mcp-server.ts:1659`  
**Impact:** Tools can now accept arrays of any type (objects, numbers, booleans, strings)

### 2. Middleware Wrapping (FIXED)
**Issue:** Only wrapped `server.use(middleware)`, not path-based or multiple middleware  
**Fix:** Enhanced proxy in `mcp-server.ts:101-138` to handle:
- `server.use(middleware)`  
- `server.use('/path', middleware)` 
- `server.use(mw1, mw2, mw3)`
- `server.use([mw1, mw2])`
- `server.use('/path', mw1, mw2)`

### 3. Duplicate Widget Logging (FIXED)
**Issue:** Same forEach loop repeated twice  
**Fix:** Removed duplicate in `mcp-server.ts:973-977`

### 4. Excluded Routes Documentation (FIXED)
**Issue:** Docs mentioned 3 routes, code only excluded 1  
**Fix:** Added `/mcp-use/widgets` and `/__vite` to `excludedMiddlewareRoutes` in `mcp-server.ts:46`

## New Authentication Middleware (Exported from mcp-use/server)

### Location
`packages/mcp-use/src/server/auth/oidc-middleware.ts`

### Exported Functions

#### 1. `oidcAuthMiddleware(config: OIDCConfig)`
**Purpose:** JWT authentication using OpenID Connect Discovery  
**Works with:** Auth0, Keycloak, Okta, Azure AD, Google, any OIDC provider

**Configuration:**
```typescript
{
  issuer: string;      // e.g., https://your-tenant.auth0.com
  audience: string;    // Your API identifier
  requiredScopes?: string[]; // Optional: ['mcp:read', 'mcp:write']
}
```

**Features:**
- Automatic JWKS discovery via `.well-known/openid-configuration`
- Public key caching per issuer
- Token signature verification (RS256, RS384, RS512, ES256, ES384, ES512)
- Scope validation
- WWW-Authenticate header on 401 (RFC 6750, MCP draft SEP-835)
- User context + scopes in `req.user` and `req.scopes`

#### 2. `bearerAuthMiddleware(validateToken)`
**Purpose:** Simple bearer token/API key authentication  
**Use case:** Simple scenarios, custom token systems

**Signature:**
```typescript
(token: string) => Promise<{ userId: string; [key: string]: any }>
```

**Features:**
- Custom validation logic
- User context in `req.user`
- Clear error messages

## Authentication Examples

### Example 1: Bearer Token (`examples/server/auth-bearer`)
**Stack:** Express + bearer token validation  
**Use case:** Simple API key authentication

**Key files:**
- `src/server.ts` - Main server with bearerAuthMiddleware
- `package.json` - Dependencies
- `README.md` - Complete setup guide
- `.env.example` - Configuration template

**Usage:**
```typescript
import { createMCPServer, bearerAuthMiddleware } from 'mcp-use/server';

const server = createMCPServer('my-server', { version: '1.0.0' });

server.use(bearerAuthMiddleware(async (token) => {
  if (token === process.env.API_KEY) {
    return { userId: 'admin', role: 'admin' };
  }
  throw new Error('Invalid API key');
}));
```

### Example 2: JWT/OIDC (`examples/server/auth-jwt`)
**Stack:** Express + JWT + OIDC Discovery  
**Providers:** Auth0, Keycloak, Okta, Azure AD, Google, etc.

**Key files:**
- `src/server.ts` - Server with oidcAuthMiddleware
- `README.md` - Provider setup guides (Auth0 & Keycloak)
- `.env.example` - OIDC configuration

**Usage:**
```typescript
import { createMCPServer, oidcAuthMiddleware } from 'mcp-use/server';

const server = createMCPServer('my-server', { version: '1.0.0' });

server.use(oidcAuthMiddleware({
  issuer: process.env.OIDC_ISSUER!,  // https://your-tenant.auth0.com
  audience: process.env.OIDC_AUDIENCE!, // your-api-identifier
  requiredScopes: ['mcp:read', 'mcp:write']
}));
```

**Environment variables:**
```env
# Works with ANY OIDC provider
OIDC_ISSUER=https://your-oidc-provider.com
OIDC_AUDIENCE=your-api-identifier

# Examples:
# Auth0: OIDC_ISSUER=https://your-tenant.auth0.com
# Keycloak: OIDC_ISSUER=https://keycloak.example.com/realms/myrealm
# Okta: OIDC_ISSUER=https://your-domain.okta.com/oauth2/default
```

### Example 3: OAuth with Discovery (`examples/server/auth-oauth`)
**Stack:** Express + OAuth 2.0 + Discovery endpoints  
**Features:** MCP draft spec compliance (SEP-797, SEP-835, SEP-985, RFC 9728)

**Key files:**
- `src/server.ts` - Server with OAuth middleware
- `src/discovery-endpoints.ts` - OAuth discovery (.well-known)
- `README.md` - OAuth flow documentation

**Discovery endpoints:**
- `/.well-known/oauth-authorization-server` (RFC 8414)
- `/.well-known/openid-configuration` (OIDC Discovery 1.0)
- `/.well-known/oauth-protected-resource` (RFC 9728)

## Testing

### Test Files Created

#### Unit Tests
1. `tests/unit/auth-middleware.test.ts` - Middleware validation tests
2. `tests/unit/middleware-wrapping.test.ts` - Proxy wrapping tests
3. `tests/unit/context-passing.test.ts` - AsyncLocalStorage tests

#### Test Helpers
- `tests/helpers/auth-helpers.ts` - JWT generation, test servers, etc.

### Running Tests
```bash
cd packages/mcp-use
pnpm test
```

## Dependencies Added

**Production:**
- `jsonwebtoken@^9.0.2` - JWT creation/verification
- `jwks-rsa@^3.1.0` - JWKS client with caching

**Development:**
- `@types/jsonwebtoken@^9.0.5` - TypeScript definitions

## Type Definitions

**File:** `src/server/auth/types.ts`

Extended Express Request interface:
```typescript
declare global {
  namespace Express {
    interface Request {
      user?: any;        // JWT claims or custom user object
      scopes?: string[]; // OAuth scopes
      apiKey?: string;   // Bearer token (for custom use)
    }
  }
}
```

## Key Features

### 1. OIDC Discovery
- Automatically fetches JWKS URI from `issuer/.well-known/openid-configuration`
- Works with ANY OIDC-compliant provider
- No provider-specific code needed

### 2. Route Exclusion
- `/inspector` - Always accessible for debugging
- `/mcp-use/widgets` - Widget assets bypass auth
- `/__vite` - Vite HMR in development

### 3. Context Passing
- AsyncLocalStorage for request context
- Available in all tool callbacks via `context` parameter
- Thread-safe for concurrent requests

### 4. WWW-Authenticate Headers
- Compliant with RFC 6750
- Includes scope information for incremental consent (SEP-835)
- Clear error messages with error_uri pointing to discovery

### 5. Scope Validation
- Optional `requiredScopes` parameter
- Supports different OAuth claim names (`scope`, `scopes`, `scp`)
- 403 response with insufficient_scope error

## Documentation

### Provider Setup Guides

**Auth0:** Complete guide in `auth-jwt/README.md`
- Application creation
- API configuration  
- Token generation
- Environment variables

**Keycloak:** Complete guide in `auth-jwt/README.md`
- Docker setup
- Realm creation
- Client configuration
- Token generation

**Generic OIDC:** Works with any provider via standard env vars

## Security Best Practices

1. **HTTPS in Production** - Always use HTTPS
2. **Token Expiration** - Reasonable expiration times (15-60 min)
3. **Audience Validation** - Always verify `aud` claim
4. **Issuer Validation** - Always verify `iss` claim  
5. **JWKS Caching** - Automatic caching with `jwks-rsa`
6. **Rate Limiting** - Add `express-rate-limit` for brute force protection
7. **Logging** - Log authentication events for security auditing

## Migration Guide

### For Users of PR #427

**Before:**
```typescript
// Custom auth middleware in your code
server.use((req, res, next) => {
  // Your auth logic
});
```

**After:**
```typescript
// Use exported middleware
import { oidcAuthMiddleware } from 'mcp-use/server';

server.use(oidcAuthMiddleware({
  issuer: process.env.OIDC_ISSUER!,
  audience: process.env.OIDC_AUDIENCE!
}));
```

### Breaking Changes
None - all changes are additions or fixes

## Next Steps

1. Add refresh token support
2. Add token revocation endpoint
3. Add OAuth client registration examples
4. Add more integration tests
5. Add performance benchmarks
6. Document multi-tenant patterns

## References

- [MCP Protocol Draft Spec](https://modelcontextprotocol.io/specification/draft/changelog)
- [RFC 6750 - Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750)
- [RFC 8414 - OAuth 2.0 Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
- [RFC 9728 - OAuth 2.0 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [SEP-797 - OpenID Connect Discovery](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/797)
- [SEP-835 - WWW-Authenticate Incremental Scope](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/835)
- [SEP-985 - OAuth Protected Resource Metadata](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/985)

