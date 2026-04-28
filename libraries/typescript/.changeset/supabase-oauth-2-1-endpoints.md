---
"mcp-use": patch
---

Fix Supabase OAuth provider to use OAuth 2.1 server endpoints

`SupabaseOAuthProvider.getAuthEndpoint()` and `getTokenEndpoint()` now return `/auth/v1/oauth/authorize` and `/auth/v1/oauth/token` — the OAuth 2.1 server paths — instead of the legacy `/auth/v1/authorize` and `/auth/v1/token`. Metadata discovery and JWT verification were already correct, so most DCR-direct clients weren't affected, but any code path that consulted the provider's endpoint getters was pointed at the wrong URLs.

Also clarifies the Supabase provider docs: adds a `<Steps>` prerequisites block (enable OAuth Server, allow dynamic OAuth apps, set consent URL, pick a sign-in method) and notes that `MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY` is used by your consent UI and Supabase SDK calls — the provider itself only needs the project ID.
