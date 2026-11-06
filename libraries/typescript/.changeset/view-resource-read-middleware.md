---
"mcp-use": patch
---

Run `resources/read` middleware, observers, and usage telemetry for view resources (`ui://views/<name>.html`). View reads previously skipped the middleware chain, so access checks and result changes in `server.use("mcp:resources/read", ...)` did not apply to them. View reads now set `ctx.view` (`{ name }`) on the `resources/read` context. On `mixedAuth` servers, hosts read views before sign-in, so `resources/read` middleware can now see a view read with `ctx.auth` undefined; check `ctx.view` before requiring `ctx.auth`.
