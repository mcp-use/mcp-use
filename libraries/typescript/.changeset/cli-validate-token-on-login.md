---
"@mcp-use/cli": patch
---

`mcp-use login` now validates the stored API key against the backend before short-circuiting with "You are already logged in." If the key is expired or revoked, login detects the 401, clears the stale config, and drops into the device-auth flow automatically. Network or other non-401 errors preserve the old "already logged in" behavior so users don't get bounced into re-auth just because they're offline.

Every command that hits the authenticated API (`whoami`, `org`, `servers`, `deployments`, `env`) now funnels errors through a shared `handleCommandError` helper. On a 401 the user sees a friendly "session expired — run `npx mcp-use login` to re-authenticate" hint instead of a raw `API request failed: 401 …` dump. The `deploy` command's existing richer re-auth flow is unchanged.
