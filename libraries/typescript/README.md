<div align="center" style="margin: 0 auto; max-width: 80%;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./packages/mcp-use/static/logo_white.svg">
    <source media="(prefers-color-scheme: light)" srcset="./packages/mcp-use/static/logo_black.svg">
    <img alt="mcp use logo" src="./packages/mcp-use/static/logo_white.svg" width="80%" style="margin: 20px auto;">
  </picture>
</div>

<h1 align="center">MCP-Use: The Complete TypeScript Framework for Model Context Protocol</h1>

<p align="center">
    <a href="https://github.com/mcp-use/mcp-use-ts/stargazers" alt="GitHub stars">
        <img src="https://img.shields.io/github/stars/mcp-use/mcp-use-ts?style=social" /></a>
    <a href="https://github.com/mcp-use/mcp-use-ts/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/github/license/mcp-use/mcp-use-ts" /></a>
    <a href="https://discord.gg/XkNkSkMz3V" alt="Discord">
        <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" /></a>
</p>

<p align="center">
  <strong>Build powerful AI agents, create MCP servers with UI widgets, and debug with built-in inspector - all in TypeScript</strong>
</p>

> **📦 Part of the [MCP-Use Monorepo](../../README.md)** - This is the TypeScript implementation. Also available in [Python](../python/README.md).

---

## 🎯 What is MCP-Use?

MCP-Use is a comprehensive TypeScript framework for building and using [Model Context Protocol (MCP)](https://modelcontextprotocol.io) applications. It provides everything you need to create AI agents that can use tools, build MCP servers with rich UI interfaces, and debug your applications with powerful developer tools.

## 🏗️ What's Included

MCP-Use for TypeScript provides the complete MCP stack:

- **🤖 MCP Agent** - Build AI agents that can use tools and reason across multiple steps
- **🔌 MCP Client** - Connect directly to MCP servers for programmatic tool access
- **🛠️ MCP Server Framework** - Create your own MCP servers with tools, resources, and prompts
- **🎨 MCP-UI Resources** - Build ChatGPT-style apps with interactive React widgets
- **🔍 MCP Inspector** - Web-based debugger for testing and monitoring

---

## 📖 Quick Links

- **[Main Repository](../../README.md)** - Overview of the entire MCP-Use ecosystem
- **[Python Version](../python/README.md)** - Python implementation for agents and clients
- **[Inspector Documentation](./packages/inspector/README.md)** - Debug your MCP servers
- **[CLI Documentation](./packages/cli/README.md)** - Build tool for MCP apps

## 📦 Packages Overview

| Package                                       | Description                                   | Version                                                                                                         | Downloads                                                                                                        |
| --------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **[mcp-use](#mcp-use-core-framework)**        | Core framework for MCP clients and servers    | [![npm](https://img.shields.io/npm/v/mcp-use.svg)](https://www.npmjs.com/package/mcp-use)                       | [![npm](https://img.shields.io/npm/dw/mcp-use.svg)](https://www.npmjs.com/package/mcp-use)                       |
| **[@mcp-use/cli](#mcp-use-cli)**              | Build tool with hot reload and auto-inspector | [![npm](https://img.shields.io/npm/v/@mcp-use/cli.svg)](https://www.npmjs.com/package/@mcp-use/cli)             | [![npm](https://img.shields.io/npm/dw/@mcp-use/cli.svg)](https://www.npmjs.com/package/@mcp-use/cli)             |
| **[@mcp-use/inspector](#mcp-use-inspector)**  | Web-based debugger for MCP servers            | [![npm](https://img.shields.io/npm/v/@mcp-use/inspector.svg)](https://www.npmjs.com/package/@mcp-use/inspector) | [![npm](https://img.shields.io/npm/dw/@mcp-use/inspector.svg)](https://www.npmjs.com/package/@mcp-use/inspector) |
| **[create-mcp-use-app](#create-mcp-use-app)** | Project scaffolding tool                      | [![npm](https://img.shields.io/npm/v/create-mcp-use-app.svg)](https://www.npmjs.com/package/create-mcp-use-app) | [![npm](https://img.shields.io/npm/dw/create-mcp-use-app.svg)](https://www.npmjs.com/package/create-mcp-use-app) |

---

## 🚀 Quick Start

Get started with MCP-Use in under a minute:

```bash
# Create a new MCP application
npx create-mcp-use-app my-mcp-app

# Navigate to your project
cd my-mcp-app

# Start development with hot reload and auto-inspector
npm run dev
```

Your MCP server is now running at `http://localhost:3000` with the inspector automatically opened in your browser!

---

## 🎨 Build ChatGPT-Style Apps with MCP-UI Resources

One of the most powerful features of MCP-Use is the ability to build **interactive UI widgets** that work alongside your MCP tools. Create ChatGPT-like experiences with custom React components that can call MCP tools and display rich, interactive content.

### Why MCP-UI Resources?

- **🖥️ Interactive Interfaces** - Build rich UIs like dashboards, kanban boards, forms, and visualizations
- **🔗 Tool Integration** - UI widgets can directly call MCP tools using the `useMcp()` hook
- **📦 Self-Contained** - Widgets are bundled and served automatically by your MCP server
- **🎯 Framework Agnostic** - Compatible with any MCP client (Claude Desktop, custom apps, etc.)
- **⚡ Hot Reload** - Development workflow with instant updates

### Quick Example

```tsx
// resources/analytics-dashboard.tsx
import { useMcp } from 'mcp-use/react'
import { useState, useEffect } from 'react'

export default function AnalyticsDashboard() {
  const { callTool } = useMcp()
  const [data, setData] = useState(null)

  useEffect(() => {
    callTool('get_analytics', { period: '7d' }).then(setData)
  }, [])

  return (
    <div className="dashboard">
      <h1>Analytics Dashboard</h1>
      <MetricsGrid data={data} />
      <Charts data={data} />
    </div>
  )
}
```

Then register it in your server:

```typescript
server.uiResource({
  type: 'externalUrl',
  name: 'analytics-dashboard',
  widget: 'analytics-dashboard',
  title: 'Analytics Dashboard',
  description: 'Real-time analytics visualization',
})
```

**Learn More:**

- [MCP-UI Resources Guide](#mcp-ui-resources) (detailed section below)
- [Create MCP-Use App](./packages/create-mcp-use-app/README.md) - Scaffolding with UI examples
- [AI SDK Integration](#-ai-sdk-integration) - Build with Vercel AI SDK

---

## 📚 Package Documentation

### mcp-use: Core Framework

The heart of the MCP-Use ecosystem - a powerful framework for building both MCP clients and servers.

#### As an MCP Client

Connect any LLM to any MCP server and build intelligent agents:

```typescript
import { MCPClient, MCPAgent } from 'mcp-use'
import { ChatOpenAI } from '@langchain/openai'

// Configure MCP servers
const client = MCPClient.fromDict({
  mcpServers: {
    filesystem: {
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem'],
    },
    github: {
      command: 'npx',
      args: ['@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN },
    },
  },
})

// Create an AI agent
const agent = new MCPAgent({
  llm: new ChatOpenAI({ model: 'gpt-4' }),
  client,
  maxSteps: 10,
})

// Use the agent with natural language
const result = await agent.run(
  'Search for TypeScript files in the project and create a summary'
)
```

**Key Client Features:**

- 🤖 **LLM Agnostic**: Works with OpenAI, Anthropic, Google, or any LangChain-supported LLM
- 🔄 **Streaming Support**: Real-time streaming with `stream()` and `streamEvents()` methods
- 🌐 **Multi-Server**: Connect to multiple MCP servers simultaneously
- 🔒 **Tool Control**: Restrict access to specific tools for safety
- 📊 **Observability**: Built-in Langfuse integration for monitoring
- 🎯 **Server Manager**: Automatic server selection based on available tools

#### As an MCP Server Framework

Build your own MCP servers with automatic inspector and UI capabilities:

```typescript
import { createMCPServer } from 'mcp-use/server'
import { z } from 'zod'

// Create your MCP server
const server = createMCPServer('weather-server', {
  version: '1.0.0',
  description: 'Weather information MCP server',
})

// Define tools with Zod schemas
server.tool('get_weather', {
  description: 'Get current weather for a city',
  parameters: z.object({
    city: z.string().describe('City name'),
    units: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  execute: async ({ city, units = 'celsius' }) => {
    const weather = await fetchWeather(city, units)
    return {
      temperature: weather.temp,
      condition: weather.condition,
      humidity: weather.humidity,
    }
  },
})

// Define resources
server.resource('weather_map', {
  description: 'Interactive weather map',
  uri: 'weather://map',
  mimeType: 'text/html',
  fetch: async () => {
    return generateWeatherMapHTML()
  },
})

// Start the server
server.listen(3000)
// 🎉 Inspector automatically available at http://localhost:3000/inspector
// 🚀 MCP endpoint at http://localhost:3000/mcp
```

**Key Server Features:**

- 🔍 **Auto Inspector**: Debugging UI automatically mounts at `/inspector`
- 🎨 **UI Widgets**: Build React components served alongside MCP tools
- 🔐 **OAuth Support**: Built-in authentication flow handling
- 📡 **Multiple Transports**: HTTP/SSE and WebSocket support
- 🛠️ **TypeScript First**: Full type safety and inference
- ♻️ **Hot Reload**: Development mode with auto-restart

#### Advanced Features

**Streaming with AI SDK Integration:**

```typescript
import { streamEventsToAISDKWithTools } from 'mcp-use'
import { LangChainAdapter } from 'ai'

// In your Next.js API route
export async function POST(req: Request) {
  const { prompt } = await req.json()

  const streamEvents = agent.streamEvents(prompt)
  const enhancedStream = streamEventsToAISDKWithTools(streamEvents)
  const readableStream = createReadableStreamFromGenerator(enhancedStream)

  return LangChainAdapter.toDataStreamResponse(readableStream)
}
```

**Custom UI Widgets:**

```tsx
// resources/analytics-dashboard.tsx
import { useMcp } from 'mcp-use/react'

export default function AnalyticsDashboard() {
  const { callTool, status } = useMcp()
  const [data, setData] = useState(null)

  useEffect(() => {
    callTool('get_analytics', { period: '7d' }).then(setData)
  }, [])

  return (
    <div>
      <h1>Analytics Dashboard</h1>
      {/* Your dashboard UI */}
    </div>
  )
}
```

[**Full mcp-use Documentation →**](./packages/mcp-use)

---

### @mcp-use/cli

Powerful build and development tool for MCP applications with integrated inspector.

```bash
# Development with hot reload
mcp-use dev

# Production build
mcp-use build

# Start production server
mcp-use start
```

**What it does:**

- 🚀 Auto-opens inspector in development mode
- ♻️ Hot reload for both server and UI widgets
- 📦 Bundles React widgets into standalone HTML pages
- 🏗️ Optimized production builds with asset hashing
- 🛠️ TypeScript compilation with watch mode

**Example workflow:**

```bash
# Start development
mcp-use dev
# Server running at http://localhost:3000
# Inspector opened at http://localhost:3000/inspector
# Watching for changes...

# Make changes to your code
# Server automatically restarts
# UI widgets hot reload
# Inspector updates in real-time
```

[**Full CLI Documentation →**](./packages/cli)

---

### @mcp-use/inspector

Web-based debugging tool for MCP servers - like Swagger UI but for MCP.

**Features:**

- 🔍 Test tools interactively with live execution
- 📊 Monitor connection status and server health
- 🔐 Handle OAuth flows automatically
- 💾 Persistent sessions with localStorage
- 🎨 Beautiful, responsive UI

**Three ways to use:**

1. **Automatic** (with mcp-use server):

```typescript
server.listen(3000)
// Inspector at http://localhost:3000/inspector
```

2. **Standalone CLI**:

```bash
npx @mcp-use/inspector --url https://mcp.example.com/sse
```

3. **Custom mounting**:

```typescript
import { mountInspector } from '@mcp-use/inspector'
mountInspector(app, '/debug')
```

[**Full Inspector Documentation →**](./packages/inspector)

---

### create-mcp-use-app

Zero-configuration project scaffolding for MCP applications.

```bash
# Interactive mode
npx create-mcp-use-app

# Direct mode
npx create-mcp-use-app my-app --template advanced
```

**What you get:**

- ✅ Complete TypeScript setup
- ✅ Pre-configured build scripts
- ✅ Example tools and widgets
- ✅ Development environment ready
- ✅ Docker and CI/CD configs (advanced template)

[**Full create-mcp-use-app Documentation →**](./packages/create-mcp-use-app)

---

## 💡 Real-World Examples

### Example 1: AI-Powered File Manager

```typescript
// Create an agent that can manage files
const agent = new MCPAgent({
  llm: new ChatOpenAI(),
  client: MCPClient.fromDict({
    mcpServers: {
      filesystem: {
        command: 'npx',
        args: [
          '@modelcontextprotocol/server-filesystem',
          '/Users/me/documents',
        ],
      },
    },
  }),
})

// Natural language file operations
await agent.run('Organize all PDF files into a "PDFs" folder sorted by date')
await agent.run('Find all TypeScript files and create a project summary')
await agent.run('Delete all temporary files older than 30 days')
```

### Example 2: Multi-Tool Research Assistant

```typescript
// Connect multiple MCP servers
const client = MCPClient.fromDict({
  mcpServers: {
    browser: { command: 'npx', args: ['@playwright/mcp'] },
    search: { command: 'npx', args: ['@mcp/server-search'] },
    memory: { command: 'npx', args: ['@mcp/server-memory'] },
  },
})

const researcher = new MCPAgent({
  llm: new ChatAnthropic(),
  client,
  useServerManager: true, // Auto-select appropriate server
})

// Complex research task
const report = await researcher.run(`
  Research the latest developments in quantum computing.
  Search for recent papers, visit official websites,
  and create a comprehensive summary with sources.
`)
```

### Example 3: Database Admin Assistant

```typescript
const server = createMCPServer('db-admin', {
  version: '1.0.0',
})

server.tool('execute_query', {
  description: 'Execute SQL query safely',
  parameters: z.object({
    query: z.string(),
    database: z.string(),
  }),
  execute: async ({ query, database }) => {
    // Validate and execute query
    const results = await db.query(query, { database })
    return { rows: results, count: results.length }
  },
})

// Create an AI-powered DBA
const dba = new MCPAgent({
  llm: new ChatOpenAI({ model: 'gpt-4' }),
  client: new MCPClient({ url: 'http://localhost:3000/mcp' }),
})

await dba.run('Show me all users who signed up this week')
await dba.run('Optimize the slow queries in the performance log')
```

---

## 🏗️ Project Structure

A typical MCP-Use project structure:

```
my-mcp-app/
├── src/
│   └── index.ts          # MCP server definition
├── resources/            # UI widgets (React components)
│   ├── dashboard.tsx     # Main dashboard widget
│   └── settings.tsx      # Settings panel widget
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── .env                 # Environment variables
└── dist/               # Build output
    ├── index.js        # Compiled server
    └── resources/      # Compiled widgets
```

---

## 🛠️ Development Workflow

### Local Development

```bash
# 1. Create your project
npx create-mcp-use-app my-project

# 2. Start development
cd my-project
npm run dev

# 3. Make changes - hot reload handles the rest
# 4. Test with the auto-opened inspector
```

### Production Deployment

```bash
# Build for production
npm run build

# Deploy with Docker
docker build -t my-mcp-server .
docker run -p 3000:3000 my-mcp-server

# Or deploy to any Node.js host
npm run start
```

---

## 🤝 Community & Support

- **Discord**: [Join our community](https://discord.gg/XkNkSkMz3V)
- **GitHub Issues**: [Report bugs or request features](https://github.com/mcp-use/mcp-use-ts/issues)
- **Documentation**: [Full docs](https://github.com/mcp-use/mcp-use-ts)

---

## 📊 Version Management

This monorepo uses [Changesets](https://github.com/changesets/changesets) for automated version management and publishing.

### For Contributors

When making changes to TypeScript packages, create a changeset to describe your changes:

```bash
# Create a changeset
cd libraries/typescript
pnpm changeset

# Follow the prompts to:
# 1. Select which packages changed
# 2. Choose the version bump type (major/minor/patch)
# 3. Write a summary of changes

# Commit the changeset with your code
git add .
git commit -m "feat: your feature description"
```

### Release Channels

#### Stable Releases (main branch)

- Push changes with changesets to `main` branch
- CI creates/updates a "Version Packages" PR automatically
- Merge the Version PR to publish stable versions
- Packages published with `latest` tag on npm

#### Canary Prereleases (canary branch)

- Push changes with changesets to `canary` branch
- CI automatically publishes prerelease versions
- Versions: `x.y.z-canary.0`, `x.y.z-canary.1`, etc.
- Published with `canary` dist tag on npm

```bash
# Install canary versions
npm install mcp-use@canary
npm install @mcp-use/cli@canary
```

---

## 🧑‍💻 Contributing

We welcome contributions! Check out our [Contributing Guide](CONTRIBUTING.md) to get started.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/mcp-use/mcp-use-ts.git
cd mcp-use-ts

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Start development
pnpm dev
```

---

## 📜 License

MIT © [MCP-Use](https://github.com/mcp-use)

---

<p align="center">
  <strong>Built with ❤️ by the MCP-Use team</strong>
</p>
