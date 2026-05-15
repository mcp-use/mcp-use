---
"mcp-use": minor
---

Add `supabaseUrl` override to `oauthSupabaseProvider` so it can point at a local or self-hosted Supabase instance (e.g. `http://localhost:54321`) instead of the hosted `https://${projectId}.supabase.co` URL. Configurable via the new `supabaseUrl` config option or `MCP_USE_OAUTH_SUPABASE_URL` environment variable; `projectId` is now optional when `supabaseUrl` is provided.
