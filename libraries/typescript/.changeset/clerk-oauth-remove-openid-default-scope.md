---
"mcp-use": minor
---

feat(mcp-use): add Clerk OAuth provider

Adds `oauthClerkProvider` for using Clerk as an OAuth authorization
server in MCP servers. Uses DCR-direct mode — MCP clients register and
authenticate directly with Clerk, and the MCP server verifies
Clerk-issued JWTs via JWKS.

Default scopes are `["profile", "email", "offline_access"]`. The
`openid` scope is excluded by default because it requires OIDC to be
explicitly enabled in the Clerk Dashboard; users who need it can pass
`scopesSupported: ["openid", "profile", "email", "offline_access"]`.
