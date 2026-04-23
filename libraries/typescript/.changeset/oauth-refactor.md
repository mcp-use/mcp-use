---
"mcp-use": minor
---

Refactor OAuth providers to use DCR-direct flow by default

**Breaking Changes (mcp-use):**
- Removed proxy mode from built-in OAuth providers (Auth0, WorkOS, Supabase, Keycloak, Better Auth)
- Built-in providers now only support DCR-direct flow: clients communicate directly with upstream authorization servers
- `verifyToken` is now an explicit required function for custom providers
- Provider configurations no longer accept `clientId`/`clientSecret` - use the new `oauthProxy` helper for providers that don't support DCR

**New Features:**
- Added `oauthProxy` helper for creating proxy-mode OAuth providers (useful for Google, GitHub, etc.)
- Added `jwksVerifier` helper function for easy JWKS-based token verification in custom providers
- Added Auth0 OAuth proxy example demonstrating the new proxy pattern
