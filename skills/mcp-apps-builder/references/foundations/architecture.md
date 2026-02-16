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
server.app.get('/health', (c) => c.json({ status: 'ok' }));

// Add Hono middleware
server.app.use(async (c, next) => {
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
```

---

## Middleware System

mcp-use uses **Hono's middleware system**, not Express.

### Middleware Signature

Hono middleware has a different signature than Express:

```typescript
// ❌ Express style (doesn't work)
server.use((req, res, next) => {
  // ...
  next();
});

// ✅ Hono style (correct)
server.use(async (c, next) => {
  // c = Context object
  await next();
});
```

### Context Object (`c`)

The Hono Context provides request/response handling:

```typescript
server.app.use(async (c, next) => {
  // Request
  const method = c.req.method;           // GET, POST, etc.
  const url = c.req.url;                 // Full URL
  const body = await c.req.json();       // Parse JSON body
  const header = c.req.header('x-api-key'); // Get header

  await next();

  // Response
  return c.json({ data: "value" });      // JSON response
  return c.text("Hello");                // Text response
  return c.status(404);                  // Status code
});
```

### Using Middleware Packages

Many Express middleware packages work via compatibility:

```typescript
import rateLimit from "express-rate-limit";

// These packages adapt to Hono automatically
server.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
```

**Recommended:** Use established packages rather than writing custom middleware.

---

## server.use() vs server.app.use()

Both work, with subtle differences:

```typescript
// Option 1: server.use() - Convenience wrapper
server.use(middleware);

// Option 2: server.app.use() - Direct Hono access
server.app.use(middleware);
```

**When to use each:**
- `server.use()` - For middleware packages, general use
- `server.app.use()` - When you need Hono-specific features

**In practice:** They're equivalent for most cases. Use `server.use()` unless you specifically need Hono features.

---

## Request Lifecycle

Understanding the flow of a request:

```
1. HTTP Request arrives
   ↓
2. Hono middleware chain (server.app.use)
   ↓
3. MCP protocol routing
   ↓
4. Tool/Resource/Prompt handler
   ↓
5. Response helpers (text, object, etc.)
   ↓
6. MCP protocol response
   ↓
7. HTTP Response
```

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

### Authentication Middleware

```typescript
server.use(async (c, next) => {
  const apiKey = c.req.header('x-api-key');

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
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

### 1. Use Middleware Packages
```typescript
✅ import rateLimit from "express-rate-limit";
✅ server.use(rateLimit({ ... }));

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

- 🏗️ **Built on Hono** - mcp-use wraps the Hono web framework
- 🔌 **Three layers** - HTTP (Hono) → MCP Protocol → Your handlers
- 🎯 **Hono middleware** - Use `(c, next) => ...` signature, not Express
- 📦 **Use packages** - Prefer established middleware over custom code
- 🔀 **Two access points** - `server.use()` and `server.app.use()` both work

---

## Next Steps

- **Build tools** → [../server/tools.md](../server/tools.md)
- **Add resources** → [../server/resources.md](../server/resources.md)
- **Understand primitives** → [concepts.md](concepts.md)
