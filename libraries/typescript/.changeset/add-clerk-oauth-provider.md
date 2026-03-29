---
"mcp-use": minor
---

Add Clerk OAuth provider for MCP server authentication

Implements `ClerkOAuthProvider` and `oauthClerkProvider()` factory, giving developers a zero-config way to add Clerk authentication to any MCP server.

## New API

- `oauthClerkProvider(config?)` — factory function, zero-config via `MCP_USE_OAUTH_CLERK_DOMAIN` env var
- `ClerkOAuthProvider` — provider class implementing the `OAuthProvider` interface
- `ClerkProviderConfig` / `ClerkOAuthConfig` — TypeScript interfaces for configuration
- `usesOidcDiscovery()` — new optional method on the `OAuthProvider` interface; when it returns `true`, `routes.ts` advertises the MCP server's own `baseUrl` as the `authorization_server` so OIDC-only providers (Clerk) work with MCP clients that only speak RFC 8414

## Token Verification

Clerk can issue two token formats depending on tenant configuration:

- **JWT tokens** (default) — verified locally via Clerk's JWKS endpoint using `jose`
- **Opaque tokens** (`oat_...`) — verified via network call to Clerk's `/oauth/userinfo` endpoint, normalised into the same `{ payload }` shape so the rest of the auth middleware is unaffected
- **`verifyJwt: false`** — skips cryptographic verification and decodes the JWT payload only; a console warning is emitted. Intended for local development only — never use in production

## Clerk-Specific Claim Mapping

- `first_name` + `last_name` → `name` (Clerk does not issue a single `name` claim)
- `image_url` → `picture` (Clerk uses `image_url` instead of the OIDC `picture` claim)
- `org_id`, `org_role`, `org_permissions` exposed on `UserInfo` for organization-scoped access control
- No `audience` claim validation (Clerk does not use it by default)

## OIDC Discovery Compatibility (`routes.ts`)

Clerk only exposes `/.well-known/openid-configuration` (OIDC Discovery) and does not implement the RFC 8414 `/.well-known/oauth-authorization-server` endpoint. Two improvements to `routes.ts` make this work transparently for all providers:

- **`fetchProviderMetadata()` helper** — tries RFC 8414 first, falls back to OIDC Discovery automatically. Any future OIDC-only provider benefits without additional code.
- **`usesOidcDiscovery()` protocol method** — when a provider returns `true`, the server advertises its own `baseUrl` as the `authorization_server` in protected resource metadata. MCP clients then fetch metadata from the local server, which proxies Clerk's OIDC metadata. This prevents MCP clients from going directly to Clerk's missing RFC 8414 endpoint.
- **`hasRegisteredClient` DCR suppression** — gated on `!isOidcOnly` so existing WorkOS pre-registered client behaviour is fully preserved.

See `examples/server/oauth/clerk/` for a complete working example with three tools demonstrating JWT claim access, full profile fetch (handles both `oat_` and JWT token types), and personalized greeting. 