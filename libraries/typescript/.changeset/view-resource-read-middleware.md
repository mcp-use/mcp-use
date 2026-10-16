---
"mcp-use": patch
---

Run `resources/read` middleware, observers, and usage telemetry for view resources (`ui://views/<name>.html`). View reads previously skipped the middleware chain, so access checks and result changes in `server.use("mcp:resources/read", ...)` did not apply to them.
