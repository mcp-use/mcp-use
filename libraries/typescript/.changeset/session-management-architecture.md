---
"mcp-use": minor
---

feat: pluggable session management architecture with Redis support

Implements a split architecture for session management, separating serializable metadata storage from active SSE stream management. This enables distributed deployments where notifications, sampling, and resource subscriptions work across multiple server instances.

## Session Management Architecture

### New Interfaces

- **SessionStore**: Pluggable interface for storing serializable session metadata (client capabilities, log level, timestamps). Implementations:
  - `InMemorySessionStore` (default) - Fast, in-memory storage
  - `RedisSessionStore` - Persistent, distributed storage for production

- **StreamManager**: Pluggable interface for managing active SSE connections. Implementations:
  - `InMemoryStreamManager` (default) - Single server only
  - `RedisStreamManager` - Distributed via Redis Pub/Sub for cross-server notifications

- **SessionMetadata**: New serializable interface for session metadata that can be stored externally
- **SessionData**: Extends SessionMetadata with non-serializable runtime objects (transport, server, context)

### Server Configuration

Added new `ServerConfig` options:
- `sessionStore?: SessionStore` - Custom session metadata storage backend
- `streamManager?: StreamManager` - Custom stream manager for active SSE connections

Deprecated:
- `autoCreateSessionOnInvalidId` - Now follows MCP spec strictly (returns 404 for invalid sessions). Use `sessionStore` with persistent backend for session persistence.

Enhanced:
- `stateless` mode now auto-detects based on client `Accept` header (supports k6, curl, and other HTTP-only clients)

### Client Improvements

- Added automatic 404 handling and re-initialization in `SseConnectionManager` and `StreamableHttpConnectionManager` per MCP spec
- Deprecated `sse` transport type in React types (use `http` or `auto`)

### Notification Enhancements

Added convenience methods:
- `sendToolsListChanged()` - Notify clients when tools list changes
- `sendResourcesListChanged()` - Notify clients when resources list changes  
- `sendPromptsListChanged()` - Notify clients when prompts list changes

### Usage Examples

```typescript
// Development (default in-memory)
const server = new MCPServer({
  name: 'dev-server',
  version: '1.0.0'
});

// Production single instance (persistent sessions)
import { RedisSessionStore } from 'mcp-use/server';
const server = new MCPServer({
  name: 'prod-server',
  version: '1.0.0',
  sessionStore: new RedisSessionStore({ client: redis })
});

// Production distributed (cross-server notifications)
import { RedisSessionStore, RedisStreamManager } from 'mcp-use/server';
const server = new MCPServer({
  name: 'prod-server',
  version: '1.0.0',
  sessionStore: new RedisSessionStore({ client: redis }),
  streamManager: new RedisStreamManager({ 
    client: redis, 
    pubSubClient: pubSubRedis 
  })
});
```

### Testing & Documentation

- Added comprehensive session management architecture documentation
- Added Redis integration guide and verification
- Added scale testing infrastructure (load testing, chaos testing, longevity tests)
- Added unit tests for session stores and stream managers

### Breaking Changes

None - all changes are backward compatible. Default behavior uses in-memory implementations, maintaining existing functionality.
