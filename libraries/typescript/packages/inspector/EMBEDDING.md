# Embeddable Inspector Component

The MCP Inspector can now be embedded as a React component in any application!

## Installation

```bash
npm install @mcp-use/inspector
# or
yarn add @mcp-use/inspector
```

## Usage

### Basic Example

```tsx
import { Inspector } from "@mcp-use/inspector/client";

function MyApp() {
  return (
    <Inspector
      serverConfig={{
        url: "https://example.com/mcp",
        name: "My Server",
        transportType: "http",
      }}
      showTabs={["tools", "prompts", "resources", "chat"]}
      apiUrl="https://api.example.com"
      className="h-[600px]"
    />
  );
}
```

### With Proxy Configuration

```tsx
<Inspector
  serverConfig={{
    url: "https://example.com/mcp",
    name: "My Server",
    transportType: "http",
    proxyConfig: {
      proxyAddress: "https://proxy.example.com",
      customHeaders: {
        "X-Custom-Header": "value",
      },
    },
  }}
  showTabs={["tools", "prompts", "resources"]}
/>
```

### With OAuth Authentication

```tsx
<Inspector
  serverConfig={{
    url: "https://example.com/mcp",
    name: "My Server",
    transportType: "http",
    auth: {
      type: "oauth2",
      client_id: "your-client-id",
      redirect_url: "https://yourapp.com/oauth/callback",
      scope: "read write",
    },
  }}
  showTabs={["tools", "prompts", "resources", "chat"]}
/>
```

## How It Works

### API URLs

The embedded Inspector uses the `apiUrl` prop to determine where to send API requests. This is crucial for features like:

- **Widget Rendering**: Storing and serving OpenAI Apps SDK widgets
- **Chat**: LLM-powered chat with MCP tools
- **Proxy**: Proxying MCP requests through a server
- **RPC Logging**: Streaming JSON-RPC logs for debugging
- **Telemetry**: Analytics and usage tracking

When `apiUrl` is provided (e.g., `"https://inspector.mcp-use.com"`), all API calls are sent to that server. When not provided, relative URLs are used (current origin).

### Example API Endpoints

- `/inspector/api/resources/widget/store` - Store widget data
- `/inspector/api/chat/stream` - Streaming chat with MCP
- `/inspector/api/proxy/*` - MCP request proxy
- `/inspector/api/rpc/stream` - RPC log streaming

## Props

### `serverConfig` (required)

Server configuration object:

- `url` (string): MCP server URL
- `name` (string, optional): Display name for the server
- `transportType` ("http" | "sse", optional): Transport type (default: "http")
- `proxyConfig` (object, optional): Proxy configuration
  - `proxyAddress` (string): Proxy server URL
  - `customHeaders` (Record<string, string>): Custom headers for proxy
- `customHeaders` (Record<string, string>, optional): Custom headers for direct connection
- `auth` (object, optional): OAuth configuration
  - `type`: "oauth2"
  - `client_id` (string): OAuth client ID
  - `redirect_url` (string): OAuth redirect URL
  - `scope` (string): OAuth scope

### `showTabs` (optional)

Array of tabs to display. Available tabs:

- `"tools"`: Tool execution interface
- `"prompts"`: Prompt templates
- `"resources"`: Resource browser
- `"chat"`: Chat with MCP tools
- `"sampling"`: LLM sampling requests
- `"elicitation"`: User input requests
- `"notifications"`: Server notifications

Default: All tabs are shown

### `apiUrl` (optional)

Backend API URL for features like chat and proxy. Default: `window.location.origin`

### `className` (optional)

Additional CSS classes for the container.

### `onConnectionStateChange` (optional)

Callback function called when connection state changes:

```tsx
onConnectionStateChange={(state) => {
  console.log('State:', state.state);
  console.log('Error:', state.error);
  console.log('Tools:', state.tools);
  console.log('Resources:', state.resources);
  console.log('Prompts:', state.prompts);
}}
```

## Features

All inspector features work in embedded mode:

✅ Tool execution with progress tracking
✅ Resource reading and display
✅ Prompt execution
✅ Chat with MCP tools
✅ Proxy configuration
✅ OAuth authentication
✅ Notifications handling
✅ Sampling requests (LLM callbacks)
✅ Elicitation requests (user input)
✅ RPC logging
✅ Widgets and UI components

## Theme

The embedded Inspector inherits the theme from the parent application. Make sure your app has a theme provider (e.g., `next-themes`) configured.

## Differences from Standalone

The embedded Inspector:

- Does NOT include the server selection dropdown
- Does NOT include the command palette
- Does NOT include GitHub/theme toggle buttons
- Does NOT persist connections to localStorage
- Shows only the tabs specified in `showTabs` prop
- Inherits theme from parent application

## Building

The package exports two separate builds:

1. **Server/CLI** (`@mcp-use/inspector`): For standalone use and Express middleware
2. **Client Library** (`@mcp-use/inspector/client`): For embedding in React apps

To build both:

```bash
cd libraries/typescript/packages/inspector
npm run build
```

This will:

1. Build the standalone client app (Vite)
2. Build the server components (tsup)
3. Build the CLI (tsup)
4. Build the client library components (tsup)

## Example Integration

See [`website.mcp-use/src/components/cloud/inspector/EmbeddedInspector.tsx`](../../../../../../../mcp-use-cloud/website.mcp-use/src/components/cloud/inspector/EmbeddedInspector.tsx) for a complete example of integrating the Inspector into a Next.js application.
