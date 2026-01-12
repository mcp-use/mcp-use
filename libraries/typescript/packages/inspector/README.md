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
    <a href="https://github.com/mcp-use/mcp-use/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/github/license/mcp-use/mcp-use-ts" /></a>
    <a href="https://github.com/mcp-use/mcp-use/stargazers" alt="GitHub stars">
        <img src="https://img.shields.io/github/stars/mcp-use/mcp-use-ts?style=social" /></a>
    <a href="https://discord.gg/XkNkSkMz3V" alt="Discord">
        <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" /></a>
</p>

🔍 **MCP Inspector by mcp-use** is an open-source, interactive developer tool for testing and debugging MCP servers with support for MCP-UI and OpenAI Apps SDK widgets. It provides a beautiful, intuitive interface for testing tools, exploring resources, managing prompts, and monitoring server connections - all from your browser.

## 🚀 Try it:

- **Online**: [inspector.mcp-use.com](https://inspector.mcp-use.com/inspector)
- **Locally**: Run `npx @mcp-use/inspector`
- **Repository**: [github.com/mcp-use/mcp-use](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/inspector)

## 🎥 Demo

[![mcp-use inspector demo video](https://github.com/user-attachments/assets/4ef1643b-6f28-473e-8e7b-40c0c454d69d)](https://www.youtube.com/watch?v=DvsNSABz1GM)


### 📖 Documentation

For detailed usage instructions and guides, visit [mcp-use.com/docs/inspector](https://mcp-use.com/docs/inspector)

---

## 📦 Related Packages

| Package                                                                                        | Description             | Version                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| [mcp-use](https://github.com/mcp-use/mcp-use/tree/main/packages/mcp-use)                       | Core MCP framework      | [![npm](https://img.shields.io/npm/v/mcp-use.svg)](https://www.npmjs.com/package/mcp-use)                       |
| [@mcp-use/cli](https://github.com/mcp-use/mcp-use/tree/main/packages/cli)                      | Build tool for MCP apps | [![npm](https://img.shields.io/npm/v/@mcp-use/cli.svg)](https://www.npmjs.com/package/@mcp-use/cli)             |
| [create-mcp-use-app](https://github.com/mcp-use/mcp-use/tree/main/packages/create-mcp-use-app) | Create MCP apps         | [![npm](https://img.shields.io/npm/v/create-mcp-use-app.svg)](https://www.npmjs.com/package/create-mcp-use-app) |

---

## ✨ Key Features

| Feature                    | Description                                                     |
| -------------------------- | --------------------------------------------------------------- |
| **🚀 Auto-Mount**          | Automatically available at `/inspector` for all mcp-use servers |
| **🔌 Multi-Connection**    | Connect to and manage multiple MCP servers simultaneously       |
| **🎯 Interactive Testing** | Test tools with live execution and real-time results            |
| **📊 Real-time Status**    | Monitor connection states, errors, and server health            |
| **🔐 OAuth Support**       | Built-in OAuth flow handling with popup authentication          |
| **💾 Persistent Sessions** | Connections saved to localStorage and auto-reconnect            |
| **🎨 Beautiful UI**        | Modern, responsive interface built with React and Tailwind      |
| **🔍 Tool Explorer**       | Browse and execute all available tools with schema validation   |
| **📁 Resource Browser**    | View and copy resource URIs with syntax highlighting            |
| **💬 Prompt Manager**      | Test and manage prompts with argument templates                 |
| **🌐 Universal Support**   | Works with HTTP/SSE and WebSocket connections                   |
| **🎨 Widget Support**      | Full support for MCP-UI and OpenAI Apps SDK widgets             |
| **🔑 BYOK Chat**           | Bring Your Own Key chat interface for testing conversational flows |
| **💾 Saved Tool Calls**    | Save and replay tool executions for repeated testing            |
| **⌨️ Quick Actions**       | Cmd + K keyboard shortcuts for rapid navigation                 |
| **🐳 Docker Ready**        | Self-host with a single Docker container for production use     |

---

## 🚀 Quick Start

### Access the Inspector

There are three ways to use the MCP Inspector:

#### 1. Online Version (Recommended for Testing)

Visit [inspector.mcp-use.com](https://inspector.mcp-use.com/inspector) - no installation required!

#### 2. Run Locally

```bash
npx @mcp-use/inspector
```

Opens the inspector in your browser at `http://localhost:8080`

#### 3. Auto-mounted with mcp-use Servers

When you create an MCP server with `mcp-use`, the inspector is automatically available at `/inspector`:

```typescript
import { MCPServer } from 'mcp-use/server'

const server = new MCPServer({
  name: 'my-server',
  version: '1.0.0',
})

// Add your tools, resources, prompts...

server.listen(3000)
// 🎉 Inspector automatically available at http://localhost:3000/inspector
```

---

## 📖 Usage Guide

### Dashboard

The main dashboard is your central hub for managing MCP server connections:

- **Connected Servers Panel** (left): View all your connected servers
- **Connect Panel** (right): Add new server connections with transport, URL, auth, and headers configuration
- **Quick Actions**: Access settings and clear sessions from the top bar

### Adding an MCP Server

To connect to an MCP server:

1. **Open Connect Panel**: Click the Connect panel on the right side of the dashboard
2. **Configure Transport**: 
   - Select "Streamable HTTP" for SSE connections
   - Select "WebSocket" for WS connections
   - Configure "stdin/stdio" for local process connections
3. **Enter Server URL**: Input the MCP server endpoint (e.g., `https://mcp.linear.app/mcp`)
4. **Configure Authentication** (if needed): Add OAuth credentials or API headers
5. **Click Connect**: Establish the connection

Example URLs:
- Linear: `https://mcp.linear.app/mcp`
- Local: `http://localhost:3000/mcp`

### OAuth Authentication

For servers requiring OAuth (like Linear):

1. After clicking **Connect**, you'll see the authorization page
2. Click **"Approve"** to grant access
3. The inspector handles the redirect automatically
4. Server appears in Connected Servers list with a green indicator

> **Privacy Note**: All authentication tokens and credentials are stored securely in your browser's local storage. Nothing is sent to our servers - everything stays on your device.

### Connected Servers

Once connected, each server shows:
- Connection status indicator (green = connected)
- Server name and URL
- Available tools count
- Action buttons: **Inspect**, **Disconnect**, **Remove**

Click **"Inspect"** to open the detailed server view.

---

## 🔍 Server Detail View

After clicking **"Inspect"** on a connected server, you'll see four main tabs:

### Tools Tab

The Tools tab displays all available tools from the MCP server.

**Features:**
- Browse all available tools with their names and descriptions
- Select a tool to view its detailed schema
- Click **"Execute"** to test the tool
- Enter JSON parameters in the input panel
- View real-time results with syntax highlighting
- Support for MCP-UI and OpenAI Apps SDK widgets

**Example**: When connected to Linear MCP server, you'll see 23+ tools for managing issues, projects, and teams.

### Resources Tab

Browse available resources from the MCP server:

- View resource descriptions and metadata
- Copy resource URIs for use in your applications
- Check MIME types and resource properties
- Preview resource content

> **Note**: Some servers (like Linear) may not expose resources, in which case you'll see "No resources available".

### Prompts Tab

Test and manage pre-configured prompts:

- View all available prompts with descriptions
- Select a prompt to see its schema
- Fill in required arguments in the form
- Click **"Render"** to execute the prompt
- Copy the rendered output for use

> **Note**: Not all servers provide prompts. If none are available, you'll see "No prompts available".

### Chat Tab

The Chat tab provides an interactive interface to test the MCP server with an LLM using **BYOK (Bring Your Own Key)**.

> **Privacy**: Your API key is stored locally in your browser and never sent to our servers. All requests are made directly from your device to your LLM provider.

**Setup:**

1. Click **"Configure API Key"** to open the configuration modal
2. Select your **Provider** (OpenAI, Anthropic, etc.)
3. Choose the **Model** (gpt-4o, claude-3-5-sonnet, etc.)
4. Enter your **API Key** (stored locally in browser)
5. Click **"Save Configuration"**

**Using Chat:**

- Type natural language queries to test the MCP server
- View tool calls in real-time with visual indicators
- See detailed JSON output for arguments and results
- Watch the assistant's response based on tool results
- Track exactly how the MCP server processes requests

---

## ⌨️ Keyboard Shortcuts

| Shortcut       | Action                     |
| -------------- | -------------------------- |
| `Cmd/Ctrl + K` | Quick search and navigation |
| `Esc`          | Close modals and overlays  |

**Quick Search (Cmd/Ctrl + K)** allows you to:
- Quickly connect to a new server
- Access documentation and tutorials
- Jump to recently used servers
- Search and execute tools directly
- Navigate to different tabs

---

## 💾 Persistency

The inspector automatically saves your configurations:

- **Server connections** persist across page reloads
- **Credentials** are stored securely in your browser's localStorage
- **Session preferences** are maintained automatically
- Clear all sessions anytime with the **"Clear All"** button

Your data never leaves your browser - everything is stored locally for privacy and security.

---

## 🐳 Self-Hosting

Deploy the MCP Inspector to your own infrastructure with a single Docker container. Perfect for enterprise environments, air-gapped networks, or when you need full control over your debugging environment.

### Docker Image

The official Docker image is available on [Docker Hub](https://hub.docker.com/r/mcpuse/inspector).

**Quick Start:**

```bash
docker run -d -p 8080:8080 --name mcp-inspector mcpuse/inspector:latest
```

Then visit `http://localhost:8080` to access your self-hosted inspector.

### Docker Deployment Options

**Using Docker Run:**

```bash
docker run -d \
  --name mcp-inspector \
  -p 8080:8080 \
  -e NODE_ENV=production \
  mcpuse/inspector:latest
```

**Using Docker Compose:**

```yaml
version: '3.8'
services:
  mcp-inspector:
    image: mcpuse/inspector:latest
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - PORT=8080
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Environment Variables

All configuration is optional. The inspector works out of the box with sensible defaults.

| Variable    | Default    | Description                  |
| ----------- | ---------- | ---------------------------- |
| `NODE_ENV`  | production | Node.js environment          |
| `PORT`      | 8080       | Port to run the inspector on |
| `HOST`      | 0.0.0.0    | Host to bind to              |

### Deploy to Railway

Deploy instantly to Railway with automatic HTTPS and custom domains:

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)

For more deployment options and support, visit the [self-hosting documentation](https://mcp-use.com/docs/inspector/self-hosting).

---

## 📊 Telemetry & Privacy

The MCP Inspector collects anonymized usage data to help us improve the tool.

### What Data is Collected?

We collect:

- **Usage events**: When you connect to servers, execute tools, read resources, or call prompts
- **Anonymous user ID**: A randomly generated UUID stored in your browser's localStorage
- **Technical information**: Package version, browser type, and connection types
- **Performance data**: Tool execution duration and success/failure rates

We **DO NOT** collect:

- Personal information (names, emails, etc.)
- Actual tool arguments or results
- Server credentials or API keys
- Resource content or data

### How to Opt Out

You can disable telemetry in several ways:

**Option 1: Environment Variable**

```bash
# Set before starting the inspector
export MCP_USE_ANONYMIZED_TELEMETRY=false
```

**Option 2: localStorage (Browser)**

```javascript
// In browser console
localStorage.setItem('mcp_inspector_telemetry_disabled', 'true')
```

**Option 3: Package-level**

```json
// Add to your package.json
{
  "scarfSettings": {
    "enabled": false
  }
}
```

### Telemetry Providers

We use:

- **PostHog**: For product analytics and feature usage tracking
- **Scarf**: For package download analytics and company insights

Both providers respect your privacy and follow GDPR compliance.
---

## 🤝 Contributing

We welcome contributions! 

See our [contributing guide](https://github.com/mcp-use/mcp-use/blob/main/CONTRIBUTING.md) for details.

---

## 📚 Learn More

- [Inspector Documentation](https://mcp-use.com/docs/inspector) - Complete usage guide and tutorials
- [Self-Hosting Guide](https://mcp-use.com/docs/inspector/self-hosting) - Deploy your own instance
- [mcp-use Documentation](https://mcp-use.com/docs) - Full framework documentation
- [Model Context Protocol](https://modelcontextprotocol.io) - Official MCP specification
- [GitHub Repository](https://github.com/mcp-use/mcp-use) - Source code and examples

---

## 📜 License

MIT © [mcp-use](https://github.com/mcp-use)
