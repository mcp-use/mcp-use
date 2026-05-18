---
"mcp-use": patch
---

Fix double slash in OAuth metadata proxy URL when using DCR-direct providers (e.g. `oauthAuth0Provider`).

Issuers canonically end with a trailing slash (e.g. `https://tenant.auth0.com/`), but the route handler at `src/server/oauth/routes.ts` was concatenating `/.well-known/oauth-authorization-server` directly onto the issuer, producing `https://tenant.auth0.com//.well-known/...`. Auth0 returns `404` for any path with a leading double slash, which broke OAuth metadata discovery end-to-end (the MCP server returned `{"error":"server_error","error_description":"Failed to fetch provider metadata: 404"}` for `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`, aborting Claude Desktop's OAuth flow).

Normalize the issuer by stripping any trailing slashes before appending `/.well-known/oauth-authorization-server`. (`new URL(path, issuer)` would have broken providers like Supabase whose issuer includes a path — e.g. `https://<project>.supabase.co/auth/v1` — because a leading-slash path resolves against the origin and strips the issuer's path.)

Closes #1482.
