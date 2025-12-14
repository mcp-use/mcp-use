---
"mcp-use": minor
---

feat: pluggable session management architecture with Redis support

Implements a split architecture for session management, separating serializable metadata storage from active SSE stream management. This enables distributed deployments where notifications, sampling, and resource subscriptions work across multiple server instances.

## Session Management Architecture

### New Interfaces

- **SessionStore**: Pluggable interface for storing serializable session metadata (client capabilities, log level, timestamps). Implementations:
  - `InMemorySessionStore` (production default) - Fast, in-memory storage
  - `FileSystemSessionStore` (dev mode default) - File-based persistence for hot reload support
  - `RedisSessionStore` - Persistent, distributed storage for production clusters

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
- **Auto-refresh on list changes**: `useMcp` hook now automatically refreshes tools, resources, and prompts when receiving `notifications/tools/list_changed`, `notifications/resources/list_changed`, or `notifications/prompts/list_changed`
- Added manual refresh methods: `refreshTools()`, `refreshResources()`, `refreshPrompts()`, and `refreshAll()` to `useMcp` return value
- Inspector UI now automatically updates when tools/resources/prompts change during development

### Notification Enhancements

Added convenience methods:
- `sendToolsListChanged()` - Notify clients when tools list changes
- `sendResourcesListChanged()` - Notify clients when resources list changes  
- `sendPromptsListChanged()` - Notify clients when prompts list changes

### Usage Examples

```typescript
// Development (default - FileSystemSessionStore for hot reload support)
const server = new MCPServer({
  name: 'dev-server',
  version: '1.0.0'
  // Sessions automatically persist to .mcp-use/sessions.json
  // Survives server restarts during hot reload!
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

### Development Experience Improvements

- **FileSystemSessionStore** (new): Sessions automatically persist to `.mcp-use/sessions.json` in development mode
- Eliminates the need for clients to re-initialize after server hot reloads
- Auto-selected in dev mode (`NODE_ENV !== 'production'`), can be overridden via `sessionStore` config
- Supports session cleanup on load (removes expired sessions older than 24 hours)

### Testing & Documentation

- Added comprehensive session management architecture documentation
- Added Redis integration guide and verification
- Added scale testing infrastructure (load testing, chaos testing, longevity tests)
- Added unit tests for session stores and stream managers

### Breaking Changes

None - all changes are backward compatible. Default behavior uses in-memory implementations, maintaining existing functionality.
