<div align="center" style="margin: 0 auto; max-width: 80%;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use-ts/main/packages/mcp-use/static/logo_white.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use-ts/main/packages/mcp-use/static/logo_black.svg">
    <img alt="mcp use logo" src="https://raw.githubusercontent.com/mcp-use/mcp-use-ts/main/packages/mcp-use/static/logo_white.svg" width="80%" style="margin: 20px auto;">
  </picture>
</div>

<h1 align="center">MCP Inspector</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/@mcp-use/inspector" alt="NPM Downloads">
        <img src="https://img.shields.io/npm/dw/@mcp-use/inspector.svg"/></a>
    <a href="https://www.npmjs.com/package/@mcp-use/inspector" alt="NPM Version">
        <img src="https://img.shields.io/npm/v/@mcp-use/inspector.svg"/></a>
    <a href="https://github.com/mcp-use/mcp-use-ts/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/github/license/mcp-use/mcp-use-ts" /></a>
    <a href="https://github.com/mcp-use/mcp-use-ts/stargazers" alt="GitHub stars">
        <img src="https://img.shields.io/github/stars/mcp-use/mcp-use-ts?style=social" /></a>
    <a href="https://discord.gg/XkNkSkMz3V" alt="Discord">
        <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" /></a>
</p>

🔍 **MCP Inspector** is a powerful web-based debugging and inspection tool for MCP (Model Context Protocol) servers. It provides a beautiful, intuitive interface for testing tools, exploring resources, managing prompts, and monitoring server connections - all from your browser. Think of it as Swagger UI for MCP servers, but better!

## 📦 Related Packages

| Package | Description | Version |
|---------|-------------|---------|
| [mcp-use](https://github.com/mcp-use/mcp-use-ts/tree/main/packages/mcp-use) | Core MCP framework | [![npm](https://img.shields.io/npm/v/mcp-use.svg)](https://www.npmjs.com/package/mcp-use) |
| [@mcp-use/cli](https://github.com/mcp-use/mcp-use-ts/tree/main/packages/cli) | Build tool for MCP apps | [![npm](https://img.shields.io/npm/v/@mcp-use/cli.svg)](https://www.npmjs.com/package/@mcp-use/cli) |
| [create-mcp-use-app](https://github.com/mcp-use/mcp-use-ts/tree/main/packages/create-mcp-use-app) | Create MCP apps | [![npm](https://img.shields.io/npm/v/create-mcp-use-app.svg)](https://www.npmjs.com/package/create-mcp-use-app) |

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| **🚀 Auto-Mount** | Automatically available at `/inspector` for all MCP-Use servers |
| **🔌 Multi-Connection** | Connect to and manage multiple MCP servers simultaneously |
| **🎯 Interactive Testing** | Test tools with live execution and real-time results |
| **📊 Real-time Status** | Monitor connection states, errors, and server health |
| **🔐 OAuth Support** | Built-in OAuth flow handling with popup authentication |
| **💾 Persistent Sessions** | Connections saved to localStorage and auto-reconnect |
| **🎨 Beautiful UI** | Modern, responsive interface built with React and Tailwind |
| **🔍 Tool Explorer** | Browse and execute all available tools with schema validation |
| **📁 Resource Browser** | View and copy resource URIs with syntax highlighting |
| **💬 Prompt Manager** | Test and manage prompts with argument templates |
| **🌐 Universal Support** | Works with HTTP/SSE and WebSocket connections |

---

## 🚀 Quick Start

### Method 1: Automatic with MCP-Use Server (Recommended)

When you create an MCP server with `mcp-use`, the inspector is automatically available:

```typescript
import { createMCPServer } from 'mcp-use/server'

const server = createMCPServer('my-server', {
  version: '1.0.0'
})

// Add your tools, resources, prompts...

server.listen(3000)
// 🎉 Inspector automatically available at http://localhost:3000/inspector
// 🚀 Auto-connects to your local server at http://localhost:3000/mcp
```

**That's it!** No additional configuration needed. The inspector:
- Automatically mounts at `/inspector`
- Auto-connects to your local MCP server
- Provides instant debugging capabilities
- Opens automatically in dev mode with `@mcp-use/cli`

### Method 2: Standalone CLI Tool

Use the inspector with any MCP server (local or remote):

```bash
# Inspect a remote server
npx mcp-inspect --url https://mcp.linear.app/sse

# Custom port
npx mcp-inspect --url http://localhost:3000/mcp --port 8080

# Open inspector without auto-connect
npx mcp-inspect
```

### Method 3: Custom Integration

Mount the inspector in your Express app at a custom path:

```typescript
import { mountInspector } from '@mcp-use/inspector'
import express from 'express'

const app = express()

// Mount at custom path
mountInspector(app, '/debug/inspector')

app.listen(3000)
// Inspector available at http://localhost:3000/debug/inspector
```

---

## 📖 Usage Guide

### Dashboard Overview

The main dashboard shows:
- **Connection Overview**: Total servers, active connections, available tools
- **Server List**: All configured servers with their current status
- **Quick Actions**: Add new server, refresh all, clear sessions

### Adding Servers

Click "Add New MCP Server" and provide:
- **Server Name** (optional): Friendly name for identification
- **Server URL**: The MCP endpoint URL

Example URLs:
- Local: `http://localhost:3000/mcp`
- Linear: `https://mcp.linear.app/sse`
- WebSocket: `ws://localhost:8080`

### Connection States

The inspector displays real-time connection states:

| State | Description | Action |
|-------|-------------|---------|
| 🔍 **discovering** | Finding the server | Wait |
| 🔄 **connecting** | Establishing connection | Wait |
| 🔐 **authenticating** | OAuth flow in progress | Complete auth |
| 📥 **loading** | Loading tools & resources | Wait |
| ✅ **ready** | Connected and operational | Use tools |
| ❌ **failed** | Connection failed | Retry |
| ⏳ **pending_auth** | Waiting for authentication | Click Authenticate |

### Testing Tools

1. Click **"Inspect"** on a connected server
2. Navigate to the **Tools** tab
3. Select a tool to view its schema
4. Click **"Execute"** to open the test panel
5. Enter JSON parameters
6. Click **"Run"** to execute
7. View results in real-time

Example tool execution:

```json
// Input for 'search_database' tool
{
  "query": "user analytics",
  "limit": 10,
  "sortBy": "date"
}

// Result
{
  "results": [...],
  "total": 42,
  "executionTime": "23ms"
}
```

### OAuth Authentication

For servers requiring OAuth (like Linear):

1. Connection shows "pending_auth" status
2. Click **"Authenticate"** button
3. Complete OAuth in the popup window
4. Connection automatically completes

If popup is blocked:
- Click "open auth page" link
- Complete authentication manually
- Return to inspector

### Resource Management

Browse available resources:
- View resource descriptions
- Copy resource URIs
- Check MIME types
- Preview resource metadata

### Prompt Testing

Test prompts with the inspector:
1. Navigate to **Prompts** tab
2. Select a prompt
3. Fill in required arguments
4. Click **"Render"** to see output
5. Copy rendered prompt for use

---

## 🎨 UI Components

### Server Card

Each server displays:
- Connection status indicator
- Server name and URL
- Available tools count
- Last connection time
- Action buttons (Connect/Disconnect/Inspect/Remove)

### Tool Explorer

The tool explorer shows:
- Tool name and description
- Input schema with types
- Output schema
- Execution panel
- Response viewer with syntax highlighting

### Chat Interface

Interactive chat for testing conversational flows:
- Send messages to test prompts
- View tool calls in real-time
- See formatted responses
- Copy conversation history

---

## 🔧 Advanced Features

### Bulk Operations

Manage multiple servers efficiently:

```javascript
// Select multiple servers
// Click "Bulk Actions"
// Choose: Connect All, Disconnect All, Remove Selected
```

### Session Management

Sessions are automatically saved to localStorage:
- Preserves server configurations
- Maintains connection preferences
- Restores on page reload
- Clear with "Clear All Sessions"

### Custom Themes

The inspector respects system theme preferences:
- Light mode for better readability
- Dark mode for reduced eye strain
- Automatic switching based on OS settings

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Quick server search |
| `Cmd/Ctrl + N` | Add new server |
| `Cmd/Ctrl + R` | Refresh all connections |
| `Esc` | Close modals |

---

## 🛠️ Configuration Examples

### Local Development Server

```javascript
// Your MCP server
import { createMCPServer } from 'mcp-use/server'

const server = createMCPServer('dev-server', {
  version: '1.0.0',
  description: 'Development MCP Server'
})

server.tool('debug_tool', {
  description: 'Debug tool for testing',
  parameters: z.object({
    message: z.string()
  }),
  execute: async ({ message }) => {
    console.log('Debug:', message)
    return { received: message, timestamp: Date.now() }
  }
})

server.listen(3000)
// Inspector at http://localhost:3000/inspector
```

### Production Server with Auth

```javascript
const server = createMCPServer('production-server', {
  version: '1.0.0',
  oauth: {
    clientId: process.env.OAUTH_CLIENT_ID,
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
    authorizationUrl: 'https://api.example.com/oauth/authorize',
    tokenUrl: 'https://api.example.com/oauth/token'
  }
})

// Inspector handles OAuth flow automatically
```

### Multiple Server Management

In the inspector, manage multiple servers:

```javascript
// Add servers via UI
// Server 1: Local Development
URL: http://localhost:3000/mcp

// Server 2: Staging
URL: https://staging.example.com/mcp

// Server 3: Production
URL: https://api.example.com/mcp
```

---

## 🏗️ Architecture

The inspector is built with modern web technologies:

### Frontend Stack
- **React 19**: UI framework
- **React Router**: Navigation
- **Tailwind CSS**: Styling
- **shadcn/ui**: Component library
- **Framer Motion**: Animations
- **React Syntax Highlighter**: Code display

### Core Components

```
src/client/
├── components/
│   ├── InspectorDashboard.tsx  # Main dashboard view
│   ├── ServerList.tsx          # Server management
│   ├── ServerDetail.tsx        # Individual server view
│   ├── ToolExecutor.tsx        # Tool testing interface
│   ├── ResourceBrowser.tsx    # Resource explorer
│   └── ChatInterface.tsx      # Interactive chat
├── context/
│   └── McpContext.tsx         # Connection state management
└── hooks/
    └── useMcp.ts              # MCP connection hook
```

### Connection Management

The `useMcp` hook handles:
- WebSocket/SSE connections
- Automatic reconnection
- OAuth flow management
- Error recovery
- State synchronization

---

## 🐛 Troubleshooting

### Common Issues and Solutions

**Inspector not loading:**
```bash
# Check server is running
curl http://localhost:3000/inspector

# Verify no conflicting routes
# Ensure inspector is mounted correctly
```

**Connection fails immediately:**
- Check CORS configuration
- Verify server URL is correct
- Ensure server supports SSE/WebSocket
- Check network/firewall settings

**OAuth popup blocked:**
- Allow popups for the inspector domain
- Use the manual auth link provided
- Check browser console for errors

**Tools not executing:**
- Verify tool schemas are valid
- Check server logs for errors
- Ensure proper authentication
- Validate input parameters

**Session not persisting:**
- Check localStorage is enabled
- Clear browser cache
- Try incognito/private mode
- Check for browser extensions blocking storage

---

## 🚀 Performance Tips

### Optimize for Large Tool Sets

```javascript
// Use pagination for many tools
server.configurePagination({
  toolsPerPage: 50,
  enableSearch: true
})
```

### Reduce Connection Overhead

```javascript
// Configure connection pooling
const inspector = {
  maxConnections: 5,
  connectionTimeout: 30000,
  keepAlive: true
}
```

### Enable Caching

```javascript
// Cache tool results
server.enableCache({
  ttl: 300, // 5 minutes
  maxSize: 100 // MB
})
```

---

## 🔒 Security Considerations

### CORS Configuration

```javascript
// Configure CORS for inspector access
server.configureCORS({
  origin: ['http://localhost:3000'],
  credentials: true
})
```

### Authentication

```javascript
// Add authentication middleware
server.use(authMiddleware)
```

### Rate Limiting

```javascript
// Prevent abuse
server.configureRateLimit({
  windowMs: 60000, // 1 minute
  max: 100 // requests
})
```

---

## 📚 API Reference

### Inspector Methods

```typescript
// Mount inspector
mountInspector(app: Express, path?: string): void

// Standalone server
startInspectorServer(port: number): void

// Configuration
configureInspector(options: InspectorOptions): void
```

### Connection Options

```typescript
interface InspectorOptions {
  autoConnect?: boolean      // Auto-connect to local server
  theme?: 'light' | 'dark' | 'auto'
  persistence?: boolean       // Save sessions
  maxConnections?: number
  connectionTimeout?: number
}
```

---

## 🤝 Contributing

We welcome contributions! Areas for improvement:
- Additional UI themes
- More keyboard shortcuts
- Enhanced tool testing features
- Performance optimizations
- Localization support

See our [contributing guide](https://github.com/mcp-use/mcp-use-ts/blob/main/CONTRIBUTING.md) for details.

---

## 📚 Learn More

- [MCP-Use Documentation](https://github.com/mcp-use/mcp-use-ts)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Creating MCP Servers](https://github.com/mcp-use/mcp-use-ts/tree/main/packages/mcp-use#-mcp-server-framework)
- [Building with React](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)

---

## 📜 License

MIT © [MCP-Use](https://github.com/mcp-use)