---
"mcp-use": patch
---

Fix middleware-to-tool-handler context propagation and `ctx.auth` typing

- **Singleton AsyncLocalStorage**: The `context-storage` module now uses `globalThis` to guarantee a single `AsyncLocalStorage` instance even when bundlers split the module into multiple chunks. Previously, dynamic imports from resources, prompts, and proxy handlers could get a different instance, causing `getRequestContext()` to return `undefined` in tool handlers.

- **Safe Hono context extraction**: Replaced `Object.create(honoContext)` with explicit property extraction in `createEnhancedContext` and `buildHandlerContext`. Hono's `Context` class uses JavaScript private fields (`#req`, `#var`) that cannot be accessed through prototype chains — `Object.create()` caused `TypeError: Cannot read private member #req`. The new approach copies public data (variables from `c.set()`, `req`, `env`) into a plain object.

- **Auth propagation from middleware to tools**: MCP middleware `ctx.auth` and `ctx.state` values are now forwarded to the enhanced tool context before the callback runs. This ensures data set by HTTP middleware (e.g., bearer token auth via `c.set("auth", ...)`) is accessible as `ctx.auth` in tool handlers.

- **`ctx.auth` typing**: `ctx.auth` is now typed as `AuthInfo | undefined` (instead of `never`) when OAuth is not configured, allowing `if (!ctx.auth) return error(...)` guards in servers with conditional OAuth.
