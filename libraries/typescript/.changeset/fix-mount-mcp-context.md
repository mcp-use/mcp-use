---
"mcp-use": patch
---

Fix regression where `ctx.auth` and other request context properties were `undefined` in tool callbacks. `mountMcp()` now wraps all `transport.handleRequest()` calls with `runWithContext()` so that `getRequestContext()` (AsyncLocalStorage) is properly populated during the MCP request lifecycle.
