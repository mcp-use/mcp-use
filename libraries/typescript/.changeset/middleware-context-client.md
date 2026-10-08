---
"mcp-use": patch
---

fix(server): declare the runtime `client` field on `MiddlewareContext`, so `mcp:tools/list` and `mcp:tools/call` middleware can call `ctx.client.info()` and the other `RequestClientContext` methods without a cast.
