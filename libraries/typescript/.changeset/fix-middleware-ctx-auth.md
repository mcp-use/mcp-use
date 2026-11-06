---
"mcp-use": patch
---

Fix `ctx.auth` in `mcp:*` middleware and observers changing shape after `await next()` on `tools/call`: the tool callback's projected auth no longer overwrites the SDK `AuthInfo` on the shared request context.
