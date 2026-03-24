---
"mcp-use": patch
---

Make `ctx.auth` accessible when OAuth is not configured

`ctx.auth` is now typed as `AuthInfo | undefined` (instead of `never`) in tool, resource, and prompt callbacks when OAuth is not configured. This allows the common guard pattern `if (!ctx.auth) return error("Not authenticated")` to compile in servers that conditionally enable OAuth via environment variables (e.g., `oauth: process.env.X ? oauthSupabaseProvider() : undefined`).

When OAuth **is** configured, `ctx.auth` remains typed as `AuthInfo` (non-optional, guaranteed present) — no change in behavior for existing OAuth servers.
