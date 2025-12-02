<div align="center" style="margin: 0 auto; max-width: 80%;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./static/logo_white.svg">
    <source media="(prefers-color-scheme: light)" srcset="./static/logo_black.svg">
    <img alt="mcp use logo" src="./static/logo_white.svg" width="80%" style="margin: 20px auto;">
  </picture>
</div>

<h1 align="center">Unified MCP Client Library</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/mcp-use" alt="NPM Downloads">
        <img src="https://img.shields.io/npm/dw/mcp-use.svg"/></a>
    <a href="https://www.npmjs.com/package/mcp-use" alt="NPM Version">
        <img src="https://img.shields.io/npm/v/mcp-use.svg"/></a>
    <a href="https://docs.mcp-use.io" alt="Documentation">
        <img src="https://img.shields.io/badge/docs-mcp--use.io-blue" /></a>
    <a href="https://mcp-use.io" alt="Website">
        <img src="https://img.shields.io/badge/website-mcp--use.io-blue" /></a>
    <a href="https://github.com/mcp-use/mcp-use/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/github/license/mcp-use/mcp-use-ts" /></a>
    <a href="https://eslint.org" alt="Code style: ESLint">
        <img src="https://img.shields.io/badge/code%20style-eslint-4B32C3.svg" /></a>
    <a href="https://github.com/mcp-use/mcp-use/stargazers" alt="GitHub stars">
        <img src="https://img.shields.io/github/stars/mcp-use/mcp-use-ts?style=social" /></a>
    <a href="https://discord.gg/XkNkSkMz3V" alt="Discord">
        <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" /></a>
</p>

🌐 **mcp-use** is a complete TypeScript framework for building and using MCP (Model Context Protocol) applications. It provides both a powerful **client library** for connecting LLMs to MCP servers and a **server framework** for building your own MCP servers with UI capabilities.

💡 Build custom AI agents, create MCP servers with React UI widgets, and debug everything with the built-in inspector - all in TypeScript.

## 📦 mcp-use Ecosystem

| Package                                                                                           | Description                                 | Version                                                                                                         |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **mcp-use**                                                                                       | Core framework for MCP clients and servers  | [![npm](https://img.shields.io/npm/v/mcp-use.svg)](https://www.npmjs.com/package/mcp-use)                       |
| [@mcp-use/cli](https://github.com/mcp-use/mcp-use/tree/main/packages/cli)                      | Build tool for MCP apps with UI widgets     | [![npm](https://img.shields.io/npm/v/@mcp-use/cli.svg)](https://www.npmjs.com/package/@mcp-use/cli)             |
| [@mcp-use/inspector](https://github.com/mcp-use/mcp-use/tree/main/packages/inspector)          | Web-based MCP server inspector and debugger | [![npm](https://img.shields.io/npm/v/@mcp-use/inspector.svg)](https://www.npmjs.com/package/@mcp-use/inspector) |
| [create-mcp-use-app](https://github.com/mcp-use/mcp-use/tree/main/packages/create-mcp-use-app) | Create MCP apps with one command            | [![npm](https://img.shields.io/npm/v/create-mcp-use-app.svg)](https://www.npmjs.com/package/create-mcp-use-app) |

---

## ✨ Key Features

| Feature                         | Description                                                                |
| ------------------------------- | -------------------------------------------------------------------------- |
| 🔄 **Ease of use**              | Create an MCP-capable agent in just a few lines of TypeScript.             |
| 🤖 **LLM Flexibility**          | Works with any LangChain.js-supported LLM that supports tool calling.      |
| 🌐 **HTTP Support**             | Direct SSE/HTTP connection to MCP servers.                                 |
| ⚙️ **Dynamic Server Selection** | Agents select the right MCP server from a pool on the fly.                 |
| 🧩 **Multi-Server Support**     | Use multiple MCP servers in one agent.                                     |
| 🛡️ **Tool Restrictions**        | Restrict unsafe tools like filesystem or network.                          |
| 🔧 **Custom Agents**            | Build your own agents with LangChain.js adapter or implement new adapters. |
| 📊 **Observability**            | Built-in support for Langfuse with dynamic metadata and tag handling.      |

---

## 🚀 Quick Start

### Requirements

- Node.js 22.0.0 or higher
- npm, yarn, or pnpm (examples use pnpm)

### Installation

```bash
# Install from npm
npm install mcp-use
# LangChain.js and your LLM provider (e.g., OpenAI)
npm install langchain @langchain/openai dotenv

# Optional: Install observability packages for monitoring
npm install langfuse @langfuse/langchain  # For Langfuse observability
```

Create a `.env`:

```ini
OPENAI_API_KEY=your_api_key
```

### Basic Usage

```ts
import { ChatOpenAI } from '@langchain/openai'
import { MCPAgent, MCPClient } from 'mcp-use'
import 'dotenv/config'

async function main() {
  // 1. Configure MCP servers
  const config = {
    mcpServers: {
      playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
    },
  }
  const client = MCPClient.fromDict(config)

  // 2. Create LLM
  const llm = new ChatOpenAI({ modelName: 'gpt-4o' })

  // 3. Instantiate agent
  const agent = new MCPAgent({ llm, client, maxSteps: 20 })

  // 4. Run query
  const result = await agent.run(
    'Find the best restaurant in Tokyo using Google Search'
  )
  console.log('Result:', result)
}

main().catch(console.error)
```

---

## 🔧 API Methods

### MCPAgent Methods

The `MCPAgent` class provides several methods for executing queries with different output formats:

#### `run(query: string, maxSteps?: number): Promise<string>`

Executes a query and returns the final result as a string.

```ts
const result = await agent.run('What tools are available?')
console.log(result)
```

#### `stream(query: string, maxSteps?: number): AsyncGenerator<AgentStep, string, void>`

Yields intermediate steps during execution, providing visibility into the agent's reasoning process.

```ts
const stream = agent.stream('Search for restaurants in Tokyo')
for await (const step of stream) {
  console.log(`Tool: ${step.action.tool}, Input: ${step.action.toolInput}`)
  console.log(`Result: ${step.observation}`)
}
```

#### `streamEvents(query: string, maxSteps?: number): AsyncGenerator<StreamEvent, void, void>`

Yields fine-grained LangChain StreamEvent objects, enabling token-by-token streaming and detailed event tracking.

```ts
const eventStream = agent.streamEvents('What is the weather today?')
for await (const event of eventStream) {
  // Handle different event types
  switch (event.event) {
    case 'on_chat_model_stream':
      // Token-by-token streaming from the LLM
      if (event.data?.chunk?.content) {
        process.stdout.write(event.data.chunk.content)
      }
      break
    case 'on_tool_start':
      console.log(`\nTool started: ${event.name}`)
      break
    case 'on_tool_end':
      console.log(`Tool completed: ${event.name}`)
      break
  }
}
```

### Key Differences

- **`run()`**: Best for simple queries where you only need the final result
- **`stream()`**: Best for debugging and understanding the agent's tool usage
- **`streamEvents()`**: Best for real-time UI updates with token-level streaming

## 🔄 AI SDK Integration

The library provides built-in utilities for integrating with [Vercel AI SDK](https://sdk.vercel.ai/), making it easy to build streaming UIs with React hooks like `useCompletion` and `useChat`.

### Installation

```bash
npm install ai @langchain/anthropic
```

### Basic Usage

```ts
import { ChatAnthropic } from '@langchain/anthropic'
import { createTextStreamResponse } from 'ai'
import {
  createReadableStreamFromGenerator,
  MCPAgent,
  MCPClient,
  streamEventsToAISDK,
} from 'mcp-use'

async function createApiHandler() {
  const config = {
    mcpServers: {
      everything: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything'],
      },
    },
  }

  const client = new MCPClient(config)
  const llm = new ChatAnthropic({ model: 'claude-sonnet-4-20250514' })
  const agent = new MCPAgent({ llm, client, maxSteps: 5 })

  return async (request: { prompt: string }) => {
    const streamEvents = agent.streamEvents(request.prompt)
    const aiSDKStream = streamEventsToAISDK(streamEvents)
    const readableStream = createReadableStreamFromGenerator(aiSDKStream)

    return createTextStreamResponse({ textStream: readableStream })
  }
}
```

### Enhanced Usage with Tool Visibility

```ts
import { streamEventsToAISDKWithTools } from 'mcp-use'

async function createEnhancedApiHandler() {
  const config = {
    mcpServers: {
      everything: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything'],
      },
    },
  }

  const client = new MCPClient(config)
  const llm = new ChatAnthropic({ model: 'claude-sonnet-4-20250514' })
  const agent = new MCPAgent({ llm, client, maxSteps: 8 })

  return async (request: { prompt: string }) => {
    const streamEvents = agent.streamEvents(request.prompt)
    // Enhanced stream includes tool usage notifications
    const enhancedStream = streamEventsToAISDKWithTools(streamEvents)
    const readableStream = createReadableStreamFromGenerator(enhancedStream)

    return createTextStreamResponse({ textStream: readableStream })
  }
}
```

### Next.js API Route Example

```ts
// pages/api/chat.ts or app/api/chat/route.ts
import { ChatAnthropic } from '@langchain/anthropic'
import { createTextStreamResponse } from 'ai'
import {
  createReadableStreamFromGenerator,
  MCPAgent,
  MCPClient,
  streamEventsToAISDK,
} from 'mcp-use'

export async function POST(req: Request) {
  const { prompt } = await req.json()

  const config = {
    mcpServers: {
      everything: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything'],
      },
    },
  }

  const client = new MCPClient(config)
  const llm = new ChatAnthropic({ model: 'claude-sonnet-4-20250514' })
  const agent = new MCPAgent({ llm, client, maxSteps: 10 })

  try {
    const streamEvents = agent.streamEvents(prompt)
    const aiSDKStream = streamEventsToAISDK(streamEvents)
    const readableStream = createReadableStreamFromGenerator(aiSDKStream)

    return createTextStreamResponse({ textStream: readableStream })
  } finally {
    await client.closeAllSessions()
  }
}
```

### Frontend Integration

```tsx
// components/Chat.tsx
import { useCompletion } from 'ai/react'

export function Chat() {
  const { completion, input, handleInputChange, handleSubmit } = useCompletion({
    api: '/api/chat',
  })

  return (
    <div>
      <div>{completion}</div>
      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Ask me anything..."
        />
      </form>
    </div>
  )
}
```

### Available AI SDK Utilities

- **`streamEventsToAISDK()`**: Converts streamEvents to basic text stream
- **`streamEventsToAISDKWithTools()`**: Enhanced stream with tool usage notifications
- **`createReadableStreamFromGenerator()`**: Converts async generator to ReadableStream

---

## 📊 Observability & Monitoring

mcp-use-ts provides built-in observability support through the `ObservabilityManager`, with integration for Langfuse and other observability platforms.

#### To enable observability simply configure Environment Variables

```ini
# .env
LANGFUSE_PUBLIC_KEY=pk-lf-your-public-key
LANGFUSE_SECRET_KEY=sk-lf-your-secret-key
LANGFUSE_HOST=https://cloud.langfuse.com  # or your self-hosted instance
```

### Advanced Observability Features

#### Dynamic Metadata and Tags

```ts
// Set custom metadata for the current execution
agent.setMetadata({
  userId: 'user123',
  sessionId: 'session456',
  environment: 'production',
})

// Set tags for better organization
agent.setTags(['production', 'user-query', 'tool-discovery'])

// Run query with metadata and tags
const result = await agent.run('Search for restaurants in Tokyo')
```

#### Monitoring Agent Performance

```ts
// Stream events for detailed monitoring
const eventStream = agent.streamEvents('Complex multi-step query')

for await (const event of eventStream) {
  // Monitor different event types
  switch (event.event) {
    case 'on_llm_start':
      console.log('LLM call started:', event.data)
      break
    case 'on_tool_start':
      console.log('Tool execution started:', event.name, event.data)
      break
    case 'on_tool_end':
      console.log('Tool execution completed:', event.name, event.data)
      break
    case 'on_chain_end':
      console.log('Agent execution completed:', event.data)
      break
  }
}
```

### Disabling Observability

To disable observability, either remove langfuse env variables or

```ts
const agent = new MCPAgent({
  llm,
  client,
  observe: false,
})
```

---

## 📂 Configuration File

You can store servers in a JSON file:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

Load it:

```ts
import { MCPClient } from 'mcp-use'

const client = MCPClient.fromConfigFile('./mcp-config.json')
```

---

## 📚 Examples

We provide a comprehensive set of examples demonstrating various use cases. All examples are located in the `examples/` directory with a dedicated README.

### Running Examples

```bash
# Install dependencies
npm install

# Run any example
npm run example:airbnb      # Search accommodations with Airbnb
npm run example:browser     # Browser automation with Playwright
npm run example:chat        # Interactive chat with memory
npm run example:stream      # Demonstrate streaming methods (stream & streamEvents)
npm run example:stream_events # Comprehensive streamEvents() examples
npm run example:ai_sdk      # AI SDK integration with streaming
npm run example:filesystem  # File system operations
npm run example:http        # HTTP server connection
npm run example:everything  # Test MCP functionalities
npm run example:multi       # Multiple servers in one session
```

### Example Highlights

- **Browser Automation**: Control browsers to navigate websites and extract information
- **File Operations**: Read, write, and manipulate files through MCP
- **Multi-Server**: Combine multiple MCP servers (Airbnb + Browser) in a single task
- **Sandboxed Execution**: Run MCP servers in isolated E2B containers
- **OAuth Flows**: Authenticate with services like Linear using OAuth2
- **Streaming Methods**: Demonstrate both step-by-step and token-level streaming
- **AI SDK Integration**: Build streaming UIs with Vercel AI SDK and React hooks

See the [examples README](./examples/README.md) for detailed documentation and prerequisites.

---

## 🔄 Multi-Server Example

```ts
const config = {
  mcpServers: {
    airbnb: { command: 'npx', args: ['@openbnb/mcp-server-airbnb'] },
    playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
  },
}
const client = MCPClient.fromDict(config)
const agent = new MCPAgent({ llm, client, useServerManager: true })
await agent.run('Search Airbnb in Barcelona, then Google restaurants nearby')
```

---

## 🔒 Tool Access Control

```ts
const agent = new MCPAgent({
  llm,
  client,
  disallowedTools: ['file_system', 'network'],
})
```

---

## 🖥️ MCP Server Framework

Beyond being a powerful MCP client, mcp-use also provides a complete server framework for building your own MCP servers with built-in UI capabilities and automatic inspector integration.

### Quick Server Setup

```ts
import { createMCPServer } from 'mcp-use/server'

// Create your MCP server
const server = createMCPServer('my-awesome-server', {
  version: '1.0.0',
  description: 'My MCP server with tools, resources, and prompts',
})

// Define tools
server.tool('search_web', {
  description: 'Search the web for information',
  parameters: z.object({
    query: z.string().describe('Search query'),
  }),
  execute: async (args) => {
    // Your tool implementation
    return { results: await performSearch(args.query) }
  },
})

// Define resources
server.resource('config', {
  description: 'Application configuration',
  uri: 'config://settings',
  mimeType: 'application/json',
  fetch: async () => {
    return JSON.stringify(await getConfig(), null, 2)
  },
})

// Define prompts
server.prompt('code_review', {
  description: 'Review code for best practices',
  arguments: [{ name: 'code', description: 'Code to review', required: true }],
  render: async (args) => {
    return `Please review this code:\n\n${args.code}`
  },
})

// Start the server
server.listen(3000)
// 🎉 Inspector automatically available at http://localhost:3000/inspector
// 🚀 MCP endpoint available at http://localhost:3000/mcp
```

### Key Server Features

| Feature                    | Description                                                      |
| -------------------------- | ---------------------------------------------------------------- |
| **🔍 Auto Inspector**      | Inspector UI automatically mounts at `/inspector` for debugging  |
| **🎨 UI Widgets**          | Build custom React UI components served alongside your MCP tools |
| **🔐 OAuth Support**       | Built-in OAuth flow handling for secure authentication           |
| **📡 Multiple Transports** | HTTP/SSE and WebSocket support out of the box                    |
| **🛠️ TypeScript First**    | Full TypeScript support with type inference                      |
| **♻️ Hot Reload**          | Development mode with automatic reloading                        |
| **📊 Observability**       | Built-in logging and monitoring capabilities                     |

### MCP-UI Resources

mcp-use provides a unified `uiResource()` method for registering interactive UI widgets that are compatible with MCP-UI clients. This automatically creates both a tool (for dynamic parameters) and a resource (for static access).

#### Quick Start

```ts
import { createMCPServer } from 'mcp-use/server'

const server = createMCPServer('my-server', { version: '1.0.0' })

// Register a widget - creates both tool and resource automatically
server.uiResource({
  type: 'externalUrl',
  name: 'kanban-board',
  widget: 'kanban-board',
  title: 'Kanban Board',
  description: 'Interactive task management board',
  props: {
    initialTasks: {
      type: 'array',
      description: 'Initial tasks',
      required: false,
    },
    theme: {
      type: 'string',
      default: 'light',
    },
  },
  size: ['900px', '600px'],
})

server.listen(3000)
```

This automatically creates:

- **Tool**: `kanban-board` - Accepts parameters and returns UIResource
- **Resource**: `ui://widget/kanban-board` - Static access with defaults

#### Three Resource Types

**1. External URL (Iframe)**
Serve widgets from your filesystem via iframe:

```ts
server.uiResource({
  type: 'externalUrl',
  name: 'dashboard',
  widget: 'dashboard',
  props: { userId: { type: 'string', required: true } },
})
```

**2. Raw HTML**
Direct HTML content rendering:

```ts
server.uiResource({
  type: 'rawHtml',
  name: 'welcome-card',
  htmlContent: `
    <!DOCTYPE html>
    <html>
      <body><h1>Welcome!</h1></body>
    </html>
  `,
})
```

**3. Remote DOM**
Interactive components using MCP-UI React components:

```ts
server.uiResource({
  type: 'remoteDom',
  name: 'quick-poll',
  script: `
    const button = document.createElement('ui-button');
    button.setAttribute('label', 'Vote');
    root.appendChild(button);
  `,
  framework: 'react',
})
```

#### Get Started with Templates

```bash
# Create a new project with UIResource examples
npx create-mcp-use-app my-app
# Select: "MCP Server with UIResource widgets"

cd my-app
npm install
npm run dev
```

### Building Custom UI Widgets

mcp-use supports building custom UI widgets for your MCP tools using React:

```tsx
// resources/task-manager.tsx
import React, { useState } from 'react'
import { useMcp } from 'mcp-use/react'

export default function TaskManager() {
  const { callTool } = useMcp()
  const [tasks, setTasks] = useState<Task[]>([])

  const addTask = async (title: string) => {
    const result = await callTool('create_task', { title })
    setTasks([...tasks, result])
  }

  return (
    <div>
      <h1>Task Manager</h1>
      {/* Your UI implementation */}
    </div>
  )
}
```

Build and serve widgets using the mcp-use CLI:

```bash
# Development with hot reload and auto-open inspector
npx @mcp-use/cli dev

# Production build
npx @mcp-use/cli build

# Start production server
npx @mcp-use/cli start
```

### Advanced Server Configuration

```ts
const server = createMCPServer('advanced-server', {
  version: '1.0.0',
  description: 'Advanced MCP server with custom configuration',
  // Custom inspector path (default: /inspector)
  inspectorPath: '/debug',
  // Custom MCP endpoint (default: /mcp)
  mcpPath: '/api/mcp',
  // Enable CORS for browser access
  cors: {
    origin: ['http://localhost:3000', 'https://myapp.com'],
    credentials: true,
  },
  // OAuth configuration
  oauth: {
    clientId: process.env.OAUTH_CLIENT_ID,
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
    authorizationUrl: 'https://api.example.com/oauth/authorize',
    tokenUrl: 'https://api.example.com/oauth/token',
    scopes: ['read', 'write'],
  },
  // Custom middleware
  middleware: [authenticationMiddleware, rateLimitingMiddleware],
})
```

### Server Deployment

Deploy your MCP server to any Node.js hosting platform:

```bash
# Build for production
npm run build

# Start with PM2
pm2 start dist/index.js --name mcp-server

# Docker deployment
docker build -t my-mcp-server .
docker run -p 3000:3000 my-mcp-server
```

### Integration with Express

You can also integrate MCP server into existing Express applications:

```ts
import express from 'express'
import { mountMCPServer } from 'mcp-use/server'

const app = express()

// Your existing routes
app.get('/api/health', (req, res) => res.send('OK'))

// Mount MCP server
const mcpServer = createMCPServer('integrated-server', {
  /* ... */
})
mountMCPServer(app, mcpServer, {
  basePath: '/mcp-service', // Optional custom base path
})

app.listen(3000)
// Inspector at: http://localhost:3000/mcp-service/inspector
// MCP endpoint: http://localhost:3000/mcp-service/mcp
```

## 👥 Contributors

<table>
<tr>
    <td align="center" style="word-wrap: break-word; width: 150.0; height: 150.0">
        <a href=https://github.com/pietrozullo>
            <img src=https://avatars.githubusercontent.com/u/62951181?v=4 width="100;"  style="border-radius:50%;align-items:center;justify-content:center;overflow:hidden;padding-top:10px" alt=Pietro Zullo/>
            <br />
            <sub style="font-size:14px"><b>Pietro Zullo</b></sub>
        </a>
    </td>
    <td align="center" style="word-wrap: break-word; width: 150.0; height: 150.0">
        <a href=https://github.com/zandko>
            <img src=https://avatars.githubusercontent.com/u/37948383?v=4 width="100;"  style="border-radius:50%;align-items:center;justify-content:center;overflow:hidden;padding-top:10px" alt=Zane/>
            <br />
            <sub style="font-size:14px"><b>Zane</b></sub>
        </a>
    </td>
    <td align="center" style="word-wrap: break-word; width: 150.0; height: 150.0">
        <a href=https://github.com/Pederzh>
            <img src=https://avatars.githubusercontent.com/u/11487621?v=4 width="100;"  style="border-radius:50%;align-items:center;justify-content:center;overflow:hidden;padding-top:10px" alt=Luigi Pederzani/>
            <br />
            <sub style="font-size:14px"><b>Luigi Pederzani</b></sub>
        </a>
    </td>
</tr>
</table>

<!-- Contributors section will be automatically generated here -->

## 📜 License

MIT © [Zane](https://github.com/zandko)
