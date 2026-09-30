---
"mcp-use": patch
---

Make MCP middleware expose the same projected `ctx.auth` object as tool, resource, and prompt callbacks. Middleware using the previous raw SDK fields should migrate from `ctx.auth.token` to `ctx.auth.accessToken` and from `ctx.auth.extra` to the projected `user`, `payload`, and `permissions` fields.
