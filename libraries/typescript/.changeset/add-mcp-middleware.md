---
"mcp-use": minor
---

Add MCP operation-level middleware via `server.use('mcp:...', fn)`

Introduces a Hono-style middleware system for intercepting MCP operations (tool calls, resource reads, prompt fetches, and list operations) without touching HTTP routing.

**Usage:**

```typescript
// Fires for every MCP operation
server.use("mcp:*", async (ctx, next) => {
  console.log(`→ [${ctx.method}]`, ctx.params);
  const result = await next();
  console.log(`← [${ctx.method}] done`);
  return result;
});

// Only fires on tool calls — ctx and next are fully typed automatically
server.use("mcp:tools/call", async (ctx, next) => {
  if (ctx.auth && !ctx.auth.scopes.includes("tools:*")) {
    throw new Error("Insufficient scope");
  }
  return next();
});
```

**Patterns:** `mcp:*` (catch-all), `mcp:tools/call`, `mcp:tools/list`, `mcp:resources/read`, `mcp:resources/list`, `mcp:prompts/get`, `mcp:prompts/list`.

**`MiddlewareContext` fields:** `method`, `params`, `session`, `auth` (populated when OAuth is configured), `state` (per-request `Map` for sharing data between middleware).

Middleware runs in registration order (onion model), is compatible with HMR, and integrates with the existing OAuth scope system. The `mcp:` prefix clearly distinguishes MCP middleware from HTTP middleware registered via the same `server.use()` call.
