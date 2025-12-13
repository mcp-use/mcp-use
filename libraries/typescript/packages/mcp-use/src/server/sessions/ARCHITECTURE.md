# Session Management Architecture

This document explains mcp-use's session management architecture and how it enables distributed MCP servers with full notification, sampling, and resource subscription support.

## Overview

mcp-use uses a **split architecture** inspired by tmcp, separating concerns into two distinct systems:

1. **SessionStore** - Manages serializable metadata
2. **StreamManager** - Manages active SSE connections

This separation is critical for enabling distributed deployments where:
- Client SSE connection is on Server A
- Client HTTP request is handled by Server B
- Server B needs to send notifications to Client (via Server A)

## The Problem: Serializing Active Connections

```typescript
// ❌ You CANNOT serialize active connections
const controller: ReadableStreamDefaultController = /* ... */;
await redis.set('session:abc', JSON.stringify({ controller }));
// TypeError: Converting circular structure to JSON

// ❌ You CANNOT transfer TCP sockets between processes
const socket: WebSocket = /* ... */;
await redis.set('session:abc', socket);
// Error: WebSocket cannot be cloned
```

## The Solution: Message Bus Pattern

Use Redis Pub/Sub (or Postgres NOTIFY) as a message bus:

```
┌─────────────────────────────────────────────────────────────┐
│                   Distributed Architecture                   │
└─────────────────────────────────────────────────────────────┘

  Client              Server A           Redis Pub/Sub        Server B
    │                    │                     │                  │
    │  GET /mcp (SSE)    │                     │                  │
    ├───────────────────►│                     │                  │
    │                    │  SUBSCRIBE          │                  │
    │                    │  mcp:stream:abc     │                  │
    │                    ├────────────────────►│                  │
    │                    │                     │                  │
    │  POST /mcp         │                     │                  │
    │  tools/call        │                     │                  │
    ├─────────────────────────────────────────────────────────►  │
    │                    │                     │                  │
    │                    │                     │  PUBLISH         │
    │                    │                     │  mcp:stream:abc  │
    │                    │                     │◄─────────────────┤
    │                    │  Pub/Sub message    │                  │
    │                    │◄────────────────────┤                  │
    │◄───────────────────┤                     │                  │
    │  SSE event         │                     │                  │
```

## Components

### SessionMetadata (Serializable)

```typescript
interface SessionMetadata {
  lastAccessedAt: number;
  logLevel?: string;
  clientCapabilities?: Record<string, unknown>;
  clientInfo?: Record<string, unknown>;
  protocolVersion?: string;
  progressToken?: number;
}
```

Can be stored in: Redis, PostgreSQL, MongoDB, DynamoDB, etc.

### SessionData (In-Memory Only)

```typescript
interface SessionData extends SessionMetadata {
  transport: Transport;           // ← Cannot serialize
  server?: McpServer;            // ← Cannot serialize
  context?: Context;             // ← Cannot serialize
  sendNotification?: Function;   // ← Cannot serialize
}
```

Only exists in memory on the server handling the session.

### SessionStore Interface

```typescript
interface SessionStore {
  get(sessionId: string): Promise<SessionMetadata | null>;
  set(sessionId: string, data: SessionMetadata): Promise<void>;
  delete(sessionId: string): Promise<void>;
  has(sessionId: string): Promise<boolean>;
  keys(): Promise<string[]>;
  setWithTTL?(sessionId: string, data: SessionMetadata, ttlMs: number): Promise<void>;
}
```

**Implementations:**
- `InMemorySessionStore` - Default, fast, sessions lost on restart
- `RedisSessionStore` - Persistent, distributed, production-ready

### StreamManager Interface

```typescript
interface StreamManager {
  create(sessionId: string, controller: ReadableStreamDefaultController): Promise<void>;
  send(sessionIds: string[] | undefined, data: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
  has(sessionId: string): Promise<boolean>;
  close?(): Promise<void>;
}
```

**Implementations:**
- `InMemoryStreamManager` - Default, single server only
- `RedisStreamManager` - Distributed via Redis Pub/Sub, enables cross-server notifications

## How Notifications Work

### Single Server (In-Memory)

```typescript
// Server directly pushes to controller
controller.enqueue(notificationData);
```

Simple, fast, but limited to one server instance.

### Distributed (Redis)

```typescript
// Server A: Has the SSE connection
await streamManager.create(sessionId, controller);
// Subscribes to Redis channel: mcp:stream:abc-123

// Server B: Handles the request, wants to send notification
await streamManager.send([sessionId], notificationData);
// Publishes to Redis channel: mcp:stream:abc-123

// Server A: Receives Redis Pub/Sub message
// → Enqueues to local controller
// → Client receives notification via SSE
```

## Use Cases

### Development

```typescript
const server = new MCPServer({
  name: 'dev-server',
  version: '1.0.0'
  // Uses defaults: InMemorySessionStore + InMemoryStreamManager
});
```

### Production Single Instance

```typescript
const server = new MCPServer({
  name: 'prod-server',
  version: '1.0.0',
  sessionStore: new RedisSessionStore({ client: redis })
  // streamManager defaults to InMemoryStreamManager (no Pub/Sub overhead)
});
```

### Production Distributed

```typescript
const server = new MCPServer({
  name: 'prod-server',
  version: '1.0.0',
  sessionStore: new RedisSessionStore({ client: redis }),
  streamManager: new RedisStreamManager({ client: redis, pubSubClient: pubSubRedis })
});
```

## Comparison with Other Implementations

| Implementation | Approach | Metadata Storage | Stream Management |
|----------------|----------|------------------|-------------------|
| **mcp-use** | Split architecture | SessionStore (pluggable) | StreamManager (pluggable) |
| **tmcp** | Split architecture | InfoSessionManager | StreamSessionManager |
| **FastMCP** | Docket + Redis | Redis keys | Redis Pub/Sub + Docket |
| **Official SDK** | Single instance | In-memory | EventStore (resumability) |
| **xmcp** | Stateless | N/A | N/A |

## Future Enhancements

Planned implementations:

- `PostgresStreamManager` - Using Postgres LISTEN/NOTIFY
- `SupabaseSessionStore` - Using Supabase SDK
- `CloudflareStreamManager` - Using Durable Objects + WebSockets
- `EventStore` integration - For resumability (like official SDK)

## References

- [tmcp session-manager packages](https://github.com/tmcp-io/tmcp/tree/main/packages)
- [FastMCP Docket integration](https://github.com/jlowin/fastmcp)
- [MCP Specification - Session Management](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management)

