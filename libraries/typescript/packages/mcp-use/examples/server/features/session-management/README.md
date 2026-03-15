# Redis Session Management

Persistent session storage with Redis so that MCP sessions survive server restarts, deploys, and scaling events.

## What it demonstrates

- **`RedisSessionStore`** — sessions are stored in Redis and recovered automatically after a server restart
- **Transparent recovery** — clients keep using the same session ID; no re-initialization needed
- **Notifications after restart** — once the client reconnects its SSE stream, notifications flow again

## Prerequisites

- Node.js 20+
- A running Redis instance

## Quick start

```bash
# Install dependencies
pnpm install

# Run (replace with your Redis URL)
REDIS_URL=redis://localhost:6379 npx tsx src/server.ts
```

The server starts on port 3000 (override with `PORT` env var).

## Testing session recovery

1. Start the server
2. Connect with the Inspector at `http://localhost:3000/inspector`
3. Call the `echo` tool — note the session ID in the response headers
4. Kill the server (`Ctrl-C`) and restart it
5. Call `echo` again with the same Inspector tab — the session is recovered from Redis

## How it works

When a client sends a request with a session ID that exists in Redis but not in the server's in-memory transport map (because the process restarted), mcp-use:

1. Looks up the session metadata from `RedisSessionStore`
2. Creates a new SDK transport and restores its initialized state
3. Registers the transport in the in-memory maps
4. Forwards the request — the client never knows the server restarted

## Key code

```typescript
import { MCPServer, RedisSessionStore } from "mcp-use/server";
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  sessionStore: new RedisSessionStore({
    client: redis,
    prefix: "mcp:session:",
    defaultTTL: 3600,
  }),
});
```

## Related docs

- [Session Management Overview](https://mcp-use.io/typescript/server/session-management)
- [Redis Storage](https://mcp-use.io/typescript/server/session-management/redis-storage)
