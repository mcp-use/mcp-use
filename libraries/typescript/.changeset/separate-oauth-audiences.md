---
"mcp-use": patch
---

Keep provider-specific JWT audiences separate from the canonical MCP resource. Restore Supabase's `authenticated` audience and Clerk's optional audience/issuer-bound token verification while continuing to reject mismatched explicit resource claims.
