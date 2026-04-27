# Architecture

Understanding how mcp-use servers are structured under the hood.

---

## Server Structure

mcp-use is **built on top of the Hono web framework**. When you create an `MCPServer`, you get:

```typescript
const server = new MCPServer({
  name: "my-server",
  version: "1.0.0"
});
```

The server instance has three key components:

### 1. `server.app` - Hono Instance

The underlying Hono web application that handles HTTP routing and middleware.

```typescript
// Add custom HTTP routes
server.get('/health', (c) => c.json({ status: 'ok' }));

// Add Hono middleware
server.use(async (c, next) => {
  console.log(`Request: ${c.req.method} ${c.req.url}`);
  await next();
});
```

**Use for:**
- Custom HTTP endpoints
- Hono-specific middleware
- Direct access to Hono features

### 2. `server.nativeServer` - MCP SDK

The official MCP protocol server from `@modelcontextprotocol/sdk`.

```typescript
// Access native MCP SDK methods (advanced)
server.nativeServer.server.setRequestHandler(...);
```

**Use for:**
- Advanced MCP protocol features
- Direct SDK access (rare)

### 3. MCP Server Methods

High-level methods for defining MCP primitives:

```typescript
server.tool({ ... }, async (input) => { ... });
server.resource({ ... }, async () => { ... });
server.prompt({ ... }, async (input) => { ... });
server.proxy({ child: { url: "..." } });
```

---

## Middleware System

mcp-use supports two kinds of middleware registered via `server.use()`:

1. **HTTP middleware** — intercepts HTTP requests (Hono layer)
2. **MCP middleware** — intercepts MCP operations like tool calls, resource reads, etc.

The `mcp:` prefix in the pattern string distinguishes them:

```typescript
// MCP middleware — fires when MCP operations occur
server.use("mcp:tools/call", async (ctx, next) => { ... });

// HTTP middleware — fires on every HTTP request (no mcp: prefix)
server.use(async (c, next) => { ... });
```

### MCP Middleware

MCP middleware intercepts operations at the protocol level, after HTTP routing. It is ideal for cross-cutting concerns like logging, authentication, rate limiting, and tool filtering.

```typescript
// Catch-all: every MCP operation
server.use("mcp:*", async (ctx, next) => {
  const start = Date.now();
  const result = await next();
  console.log(`${ctx.method} — ${Date.now() - start}ms`);
  return result;
});

// Specific operation
server.use("mcp:tools/call", async (ctx, next) => {
  if (!ctx.auth?.scopes.includes("tools:call")) {
    throw new Error("Insufficient scope");
  }
  return next();
});

// Namespace wildcard
server.use("mcp:tools/*", async (ctx, next) => {
  console.log(`Tool operation: ${ctx.method}`);
  return next();
});
```

**Pattern matching:**

| Pattern | Matches |
|---------|---------|
| `mcp:*` | Every MCP operation |
| `mcp:tools/*` | All tool operations |
| `mcp:tools/call` | Tool calls only |
| `mcp:resources/*` | All resource operations |
| `mcp:prompts/*` | All prompt operations |

**`MiddlewareContext` fields:**

| Field | Description |
|-------|-------------|
| `ctx.method` | MCP method name (e.g. `"tools/call"`) |
| `ctx.params` | Request params — mutable |
| `ctx.session` | Session ID when available |
| `ctx.auth` | OAuth info (scopes, permissions, user) when OAuth is configured |
| `ctx.state` | `Map` for passing data across middleware in the same request |

### HTTP Middleware

mcp-use uses **Hono's middleware system** for HTTP middleware. Both Hono and Express middleware are supported.

```typescript
// ✅ Hono style
server.use(async (c, next) => {
  // c = Hono Context object
  await next();
});

// ✅ Express style (auto-adapted)
import morgan from "morgan";
server.use(morgan("combined"));
```

#### Hono-Compatible Middleware

```typescript
import { rateLimiter } from "hono-rate-limiter";

server.use(rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  keyGenerator: (c) =>
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
}));
```

#### Express Middleware (Auto-Adapted)

```typescript
import rateLimit from "express-rate-limit";

server.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
}));
```

---

## server.use() routing

`server.use()` handles three kinds of middleware depending on the first argument:

```typescript
// MCP middleware (mcp: prefix) — intercepts MCP operations
server.use("mcp:tools/call", async (ctx, next) => { ... });
server.use("mcp:*",          async (ctx, next) => { ... });

// HTTP middleware with path (leading /) — Hono path-scoped middleware
server.use("/api/*", someHttpMiddleware);

// HTTP middleware without path — Hono catch-all
server.use(async (c, next) => { ... });
```

`server.app.use()` always routes to Hono and never to MCP middleware:

```typescript
// Always Hono, never MCP
server.app.use(async (c, next) => { ... });
```

**In practice:** Use `server.use("mcp:...", handler)` for MCP middleware and `server.use(handler)` or `server.app.use(handler)` for HTTP middleware.

---

## Request Lifecycle

Understanding the flow of a request:

```
1. HTTP Request arrives
   ↓
2. Hono middleware chain (server.use without mcp: prefix)
   ↓
3. OAuth bearer auth (if `oauth` is configured — verifies JWT, populates ctx.auth)
   ↓
4. MCP protocol routing
   ↓
5. MCP middleware chain (server.use('mcp:...') handlers)
   ↓
6. Tool/Resource/Prompt handler
   ↓
7. Response helpers (text, object, etc.)
   ↓
8. MCP protocol response
   ↓
9. HTTP Response
```

> When `oauth` is configured, unauthenticated requests to `/mcp/*` receive a `401` with a `WWW-Authenticate` header that tells MCP clients where to start the OAuth flow. See [../authentication/overview.md](../authentication/overview.md) for setup.

### Example Flow

```typescript
server.app.use(async (c, next) => {
  console.log("1. Middleware start");
  await next();
  console.log("5. Middleware end");
});

server.tool(
  { name: "greet", schema: z.object({ name: z.string() }) },
  async ({ name }) => {
    console.log("3. Tool handler");
    return text(`Hello, ${name}`); // 4. Response helper
  }
);
```

---

## Custom HTTP Endpoints

You can mix MCP tools with custom HTTP routes:

```typescript
// MCP tool (called via MCP protocol)
server.tool({ name: "calculate", ... }, async (input) => { ... });

// Custom HTTP endpoint (called via HTTP)
server.app.get('/api/status', (c) => {
  return c.json({
    uptime: process.uptime(),
    tools: server.registeredTools.length
  });
});

// Both coexist on the same server
```

**Use cases:**
- Health check endpoints
- Webhooks
- Admin APIs
- Public data endpoints

---

## Common Patterns

### Logging Middleware

```typescript
server.use(async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(`${c.req.method} ${c.req.path} - ${duration}ms`);
});
```

### Error Handling

```typescript
server.use(async (c, next) => {
  try {
    await next();
  } catch (err) {
    console.error("Server error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});
```

---

## Best Practices

### 1. Use Hono-Compatible Middleware Packages
```typescript
✅ import { rateLimiter } from "hono-rate-limiter";
✅ server.use(rateLimiter({ ... }));

❌ Writing custom rate limiting logic
```

### 2. Understand the Signature
```typescript
✅ server.use(async (c, next) => { ... });

❌ server.use((req, res, next) => { ... }); // Express style
```

### 3. Access Hono When Needed
```typescript
✅ server.app.get('/custom', (c) => c.json({ ... }));

❌ Trying to add routes via server.get() // Doesn't exist
```

### 4. Keep MCP Separate from HTTP
```typescript
✅ MCP tools for AI interactions
✅ HTTP routes for webhooks/admin
✅ Both on same server

❌ Mixing concerns in tool handlers
```

---

## Key Takeaways

- **Built on Hono** - mcp-use wraps the Hono web framework
- **Two middleware layers** - HTTP (Hono) layer and MCP operation layer
- **`mcp:` prefix** - Use `server.use('mcp:tools/call', handler)` for MCP middleware; no prefix = HTTP middleware
- **Hono style** - HTTP middleware uses `(c, next) => ...` signature
- **Two access points** - `server.use()` and `server.app.use()` both work for HTTP

---

## Next Steps

- **Build tools** → [../server/tools.md](../server/tools.md)
- **Add resources** → [../server/resources.md](../server/resources.md)
- **Understand primitives** → [concepts.md](concepts.md)
