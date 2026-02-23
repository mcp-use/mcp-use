# Express Middleware Example

This example demonstrates using both Express and Hono middlewares with mcp-use server.

## Features

- ✅ **Express Middleware**: Shows how to use Express-style middleware `(req, res, next) => void`
- ✅ **Hono Middleware**: Shows how to use Hono-style middleware `(c, next) => Promise<void>`
- ✅ **Mixed Middleware**: Demonstrates using both types together
- ✅ **MCP Tool**: Includes a tool that can be called via MCP protocol
- ✅ **Custom Routes**: Shows GET and POST routes with middleware protection

## Middleware Types

### Express Middleware from npm
```javascript
import morgan from "morgan";
import rateLimit from "express-rate-limit";

const morganLogger = morgan("combined");
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

server.use(morganLogger);
server.use("/api", apiLimiter);
```

### Hono Middleware
```javascript
const honoLogger = async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(`[Hono Middleware] ${c.req.method} ${c.req.path} - ${duration}ms`);
};
```

## Routes

- `GET /public/info` - Public endpoint (no rate limiting)
- `GET /api/health` - Rate limited endpoint (100 requests per 15 minutes)
- `POST /api/data` - Rate limited endpoint (100 requests per 15 minutes)

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

### Test Protected Routes (rate limited)
```bash
curl http://localhost:3000/api/health
# Returns: {"status":"ok","timestamp":"...","duration":0}
# Note: After 100 requests in 15 minutes, you'll get rate limit error
```

### Test POST Route
```bash
curl -X POST http://localhost:3000/api/data \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'
```

## Type Safety

This example demonstrates that TypeScript correctly accepts both Express and Hono middleware types without type errors. The `server.use()` method is properly typed to accept:

- `MiddlewareHandler` (Hono middleware)
- `ExpressMiddleware` (Express middleware from npm packages)
- `ExpressErrorMiddleware` (Express error middleware)

The example uses real npm packages (`morgan` and `express-rate-limit`) to demonstrate that actual Express middleware works seamlessly with the Hono server.
