---
"mcp-use": patch
---

Improve MCP middleware and tool typing ergonomics

- **Typed MCP middleware context**: `server.use("mcp:tools/call", ...)` now narrows `ctx.params` to `{ name: string; arguments?: Record<string, unknown> }` instead of the generic `Record<string, unknown>`. Same for `mcp:resources/read` (typed `uri`) and `mcp:prompts/get` (typed `name` + `arguments`). Wildcard patterns (`mcp:*`) fall back to the base `MiddlewareContext`.
- **`outputSchema` + response helpers compatibility**: Tools with `outputSchema` can now return `text()`, `mix()`, `markdown()`, and other content helpers without a type error. The callback return type is widened to `Promise<TypedCallToolResult<TOutput> | CallToolResult>`.
- **Typed `resourceTemplate` params**: `server.resourceTemplate()` now accepts an optional `schema` field (Zod schema). When provided, the callback's `params` argument is narrowed to `z.infer<schema>` instead of `Record<string, any>`, matching how `server.tool()` works.
