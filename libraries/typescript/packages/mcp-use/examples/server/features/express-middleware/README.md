# Express Middleware Example

This example demonstrates using both Express and Hono middlewares with mcp-use server.

## Features

- ✅ **Express Middleware**: Shows how to use Express-style middleware `(req, res, next) => void`
- ✅ **Hono Middleware**: Shows how to use Hono-style middleware `(c, next) => Promise<void>`
- ✅ **Mixed Middleware**: Demonstrates using both types together
- ✅ **MCP Tool**: Includes a tool that can be called via MCP protocol
- ✅ **Custom Routes**: Shows GET and POST routes with middleware protection

## Middleware Types

### Express Middleware
```typescript
const expressLogger = (req: any, res: any, next: () => void) => {
  console.log(`[Express Middleware] ${req.method} ${req.url}`);
  next();
};
```

### Hono Middleware
```typescript
const honoLogger = async (c: any, next: any) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(`[Hono Middleware] ${c.req.method} ${c.req.path} - ${duration}ms`);
};
```

## Routes

- `GET /public/info` - Public endpoint (no auth required)
- `GET /api/health` - Protected endpoint (requires Authorization header)
- `POST /api/data` - Protected endpoint (requires Authorization header)

## Running

```bash
pnpm install
pnpm dev
```

The server will start on `http://localhost:3000`

## Testing

### Test Public Route
```bash
curl http://localhost:3000/public/info
```

### Test Protected Routes (will fail without auth)
```bash
curl http://localhost:3000/api/health
# Returns: {"error":"Unauthorized"}

curl -H "Authorization: Bearer token" http://localhost:3000/api/health
# Returns: {"status":"ok","timestamp":"...","duration":0}
```

### Test POST Route
```bash
curl -X POST http://localhost:3000/api/data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token" \
  -d '{"test":"data"}'
```

## Type Safety

This example demonstrates that TypeScript correctly accepts both Express and Hono middleware types without type errors. The `server.use()` method is properly typed to accept:

- `MiddlewareHandler` (Hono middleware)
- `ExpressMiddleware` (Express middleware)
- `ExpressErrorMiddleware` (Express error middleware)
