# MCP Use React Examples

This directory contains React examples that demonstrate how to use the `mcp-use` library in a React/browser application.

## Examples

### 1. Single Server Example (`/`)
Demonstrates the `useMcp` hook for connecting to a single MCP server with OAuth authentication:
- OAuth authentication flow with Linear's MCP server
- Tool, resource, and prompt listing
- Connection state management
- Error handling and retry logic

### 2. Multi-Server Example (`/multi-server`)
Demonstrates the `McpClientProvider` for managing multiple MCP servers:
- Connect to multiple servers simultaneously
- Add/remove servers dynamically
- Per-server notification management
- Sampling and elicitation request handling
- Access servers via `useMcpClient()` and `useMcpServer(id)` hooks

## Features

The examples showcase:
- Use React-first APIs from `mcp-use/react` (`useMcp`, `McpClientProvider`, `useMcpClient`)
- Connect to MCP servers via Streamable HTTP (with SSE compatibility fallback where needed)
- Display available tools from connected servers
- Handle loading states and errors
- OAuth authentication with automatic token management

## Browser Compatibility

The React examples rely on the browser-compatible client under the hood and support:

- ✅ **HTTP/Streamable MCP connections** for browser-hosted clients
- ✅ **OAuth authentication flows** (popup/redirect) with callback handling
- ❌ **Stdio connections**: Not supported in browser environments

Example configurations:

```typescript
// useMcp (single server)
const mcp = useMcp({
  url: "https://mcp.linear.app/mcp",
  preventAutoAuth: true,
});

// McpClientProvider (multi-server)
addServer("my-server", {
  url: "https://api.example.com/mcp",
  headers: {
    Authorization: "Bearer YOUR_TOKEN",
  },
});
```

## Setup

1. First, build the main `mcp-use` library:

   ```bash
   cd ../../
   pnpm build
   ```

2. Install dependencies for the React example:

   ```bash
   cd examples/react
   pnpm install
   ```

3. Build the React example:

   ```bash
   pnpm build
   ```

4. Preview the example:
   ```bash
   pnpm preview
   ```

## Development

To run in development mode:

```bash
pnpm dev
```

This will start a development server with hot reloading.

### Available Routes

- **`/`** - Single server example with OAuth (Linear MCP)
- **`/multi-server`** - Multi-server management example
- **`/oauth/callback`** - OAuth callback handler (automatically handled)

## Features

The React example includes:

- **MCPTools Component**: A React component that displays available tools from MCP servers
- **Tool Display**: Shows tool names, descriptions, and input schemas
- **Server Management**: Connect/disconnect from MCP servers
- **Error Handling**: Displays connection errors and loading states
- **Responsive UI**: Clean, modern interface for exploring MCP tools

## Configuration

The single-server example connects to Linear MCP (`https://mcp.linear.app/mcp`) and demonstrates manual OAuth triggering. Update `url` in `react_example.tsx` to target a different MCP server.

## File Structure

- `index.html` - HTML template for all examples
- `index.tsx` - Entry point with routing and navigation
- `react_example.tsx` - Single server example with OAuth
- `multi-server-example.tsx` - Multi-server management example
- `oauth-callback.tsx` - OAuth callback handler
- `vite.config.ts` - Vite bundler configuration (includes browser polyfills)
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration

## Important Notes

### Vite Configuration

The `vite.config.ts` includes necessary polyfills for browser compatibility:

```typescript
const config = {
  define: {
    'global': 'globalThis',
    'process.env.DEBUG': 'undefined',
    'process.platform': '""',
    'process.version': '""',
    'process.argv': '[]',
  }
}
```

These definitions ensure that Node.js-specific code paths are properly handled in the browser environment.

### Real MCP Client

This example uses the real MCP client stack from `mcp-use` (through `mcp-use/react`), not mocks. It includes:

- Real HTTP/Streamable MCP connectors
- Full MCP protocol implementation
- Actual tool listing and execution capabilities
- Browser-safe logging (falls back to console)
