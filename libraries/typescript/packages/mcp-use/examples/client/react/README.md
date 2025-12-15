# MCP Use React Example

This is a React example that demonstrates how to use the `mcp-use` library in a React/browser application. The example shows how to:

- Import and initialize the MCPClient from `mcp-use/browser`
- Connect to MCP servers via WebSocket or HTTP/SSE
- Display available tools from connected servers
- Handle loading states and errors

## Browser Compatibility

The browser version (`mcp-use/browser`) supports:

- ✅ **WebSocket connections**: Connect to MCP servers via WebSocket
- ✅ **HTTP/SSE connections**: Connect to MCP servers via HTTP or Server-Sent Events
- ❌ **Stdio connections**: Not supported (requires Node.js child_process)

Example configurations:

```typescript
// WebSocket connection
const config = {
  mcpServers: {
    myServer: {
      ws_url: 'ws://localhost:8080',
      authToken: 'optional-token'
    }
  }
}

// HTTP connection (with automatic SSE fallback)
const config = {
  mcpServers: {
    myServer: {
      url: 'http://localhost:8080',
      authToken: 'optional-token',
      preferSse: false // Set to true to force SSE
    }
  }
}
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

## Features

The React example includes:

- **MCPTools Component**: A React component that displays available tools from MCP servers
- **Tool Display**: Shows tool names, descriptions, and input schemas
- **Server Management**: Connect/disconnect from MCP servers
- **Error Handling**: Displays connection errors and loading states
- **Responsive UI**: Clean, modern interface for exploring MCP tools

## Configuration

The example uses a default configuration with a filesystem server. You can modify the `exampleConfig` in `react_example.tsx` to use different MCP servers.

## File Structure

- `index.tsx` - Entry point for the React application
- `react_example.tsx` - Main React component with MCP integration
- `react_example.html` - HTML template
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

This example uses the **actual** MCP client code from `mcp-use/browser`, not mocks. It includes:

- Real WebSocket and HTTP/SSE connectors
- Full MCP protocol implementation
- Actual tool listing and execution capabilities
- Browser-safe logging (falls back to console)
