---
"create-mcp-use-app": minor
"@mcp-use/inspector": minor
"mcp-use": minor
"@mcp-use/cli": minor
---

## Breaking Changes

### LangChain Adapter Export Path Changed

The LangChain adapter is no longer exported from the main entry point. Import from `mcp-use/adapters` instead:

```typescript
// Before
import { LangChainAdapter } from 'mcp-use'

// After
import { LangChainAdapter } from 'mcp-use/adapters'
```

**Note:** `@langchain/core` and `langchain` moved from dependencies to optional peer dependencies.

### WebSocket Transport Removed

WebSocket transport support has been removed. Use streamable HTTP or SSE transports instead.

## Features

### Session Management Architecture with Redis Support

Implements a pluggable session management architecture enabling distributed deployments with cross-server notifications, sampling, and resource subscriptions.

**New Interfaces:**
- `SessionStore` - Pluggable interface for storing session metadata
  - `InMemorySessionStore` (production default)
  - `FileSystemSessionStore` (dev mode default)
  - `RedisSessionStore` (distributed deployments)
- `StreamManager` - Manages active SSE connections
  - `InMemoryStreamManager` (default)
  - `RedisStreamManager` (distributed via Redis Pub/Sub)

**Server Configuration:**

```typescript
// Development (default - FileSystemSessionStore for hot reload)
const server = new MCPServer({
  name: 'dev-server',
  version: '1.0.0'
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

**Client Improvements:**
- Auto-refresh tools/resources/prompts when receiving list change notifications
- Manual refresh methods: `refreshTools()`, `refreshResources()`, `refreshPrompts()`, `refreshAll()`
- Automatic 404 handling and re-initialization per MCP spec

**Convenience Methods:**
- `sendToolsListChanged()` - Notify clients when tools list changes
- `sendResourcesListChanged()` - Notify clients when resources list changes
- `sendPromptsListChanged()` - Notify clients when prompts list changes

**Development Experience:**
- FileSystemSessionStore persists sessions to `.mcp-use/sessions.json` in dev mode
- Sessions survive server hot reloads
- Auto-cleanup of expired sessions (>24 hours)

**Deprecated:**
- `autoCreateSessionOnInvalidId` - Now follows MCP spec strictly (returns 404 for invalid sessions)

### Favicon Support for Widgets

Added favicon configuration for widget pages:

```typescript
const server = createMCPServer({
  name: 'my-server',
  version: '1.0.0',
  favicon: 'favicon.ico' // Path relative to public/ directory
});
```

- Favicon automatically served at `/favicon.ico` for entire server domain
- CLI build process includes favicon in widget HTML pages
- Long-term caching (1 year) for favicon assets

### CLI Client Support

Added dedicated CLI client support for better command-line integration and testing.

### Enhanced Session Methods

- `callTool()` method now defaults args to an empty object
- New `requireSession()` method for reliable session retrieval

## Improvements

### Widget Build System

- Automatic cleanup of stale widget directories in `.mcp-use` folder
- Dev mode watches for widget file/directory deletions and cleans up build artifacts

### Dependency Management

- Added support for Node >= 18
- Added CommonJS module support

### Documentation & Metadata

- Updated agent documentation and method signatures
- Added repository metadata to package.json

## Fixes

### Widget Fixes

- Fixed widget styling isolation - widgets no longer pick up mcp-use styles
- Fixed favicon URL generator for proper asset resolution

### React Router Migration

Migrated from `react-router-dom` to `react-router` for better compatibility and reduced bundle size.

### Session & Transport Fixes

- Fixed transport cleanup when session becomes idle
- Fixed agent access to resources and prompts

### Code Quality

- Formatting and linting improvements across packages

