---
"mcp-use": minor
---

Add MCP operation middleware, observer events, optional CORS, and universal handler mounting on the fetch-native v2 server.

- **`server.use('mcp:…')`** — intercept tool/resource/prompt calls and list operations with a `next()` chain; typed `ctx.params` for `tools/call`, `resources/read`, and `prompts/get`
- **`server.on('mcp:…')` / `server.on('mcp:…:complete')`** — read-only observers for logging and metrics (throws do not fail the request)
- **`ServerConfig.cors`** — optional CORS on MCP-owned routes (`getHandler()` / `listen()`); pair with `allowedOrigins` for browser clients
- **`getHandler()`** — universal web handler (raw `Request` or Hono-style `{ req: { raw } }`); **`getNodeHandler()`** — internal Node `(req, res)` bridge for custom `http.Server` composition
- Export middleware helpers and types (`composeMiddleware`, `matchesPattern`, `MiddlewareContext`, `FrameworkHandler`, `CorsOptions`, …)
