# mcp-use Server

A developer-friendly wrapper around the official Model Context Protocol (MCP) SDK for creating MCP servers in TypeScript.

## Features

- 🚀 **Easy Setup**: Create MCP servers with minimal boilerplate
- 🔧 **Type Safe**: Full TypeScript support with proper type inference
- 📦 **Resource Management**: Define resources with simple URIs
- 🛠️ **Tool Integration**: Create tools with input validation
- 💬 **Prompt Templates**: Define reusable prompt templates
- 🎯 **Template Support**: Parameterized resource templates

## Installation

```bash
npm install mcp-use
# or
yarn add mcp-use
# or
pnpm add mcp-use
```

## Quick Start

```typescript
import { create } from 'mcp-use/server'

// Create an MCP server
const mcp = create('my-mcp-server', {
  version: '0.1.0',
  description: 'My awesome MCP server',
})

// Define a resource
mcp.resource({
  uri: 'dir://desktop',
  name: 'Desktop Directory',
  description: 'Lists files on the desktop',
  mimeType: 'text/plain',
  readCallback: async () => {
    return 'file://desktop/file1.txt\nfile://desktop/file2.txt'
  },
})

// Define a tool
mcp.tool({
  name: 'greet',
  description: 'Greets a person',
  inputs: [
    {
      name: 'name',
      type: 'string',
      description: 'The name to greet',
      required: true,
    },
  ],
  cb: async ({ name }) => {
    return `Hello, ${name}!`
  },
})

// Define a prompt
mcp.prompt({
  name: 'introduction',
  description: 'Generates an introduction',
  args: [
    {
      name: 'name',
      type: 'string',
      description: 'Your name',
      required: true,
    },
  ],
  cb: async ({ name }) => {
    return `Hi there! My name is ${name}. It's nice to meet you!`
  },
})

// Start the server
mcp.serve().catch(console.error)
```

## API Reference

### `create(name, config?)`

Creates a new MCP server instance.

**Parameters:**

- `name` (string): The server name
- `config` (object, optional): Server configuration
  - `version` (string): Server version (default: '1.0.0')
  - `description` (string): Server description

**Returns:** `McpServer` instance

### `mcp.resource(definition)`

Defines a resource that can be accessed by clients.

**Parameters:**

- `definition.uri` (string): The resource URI
- `definition.name` (string, optional): Resource name
- `definition.description` (string, optional): Resource description
- `definition.mimeType` (string, optional): MIME type
- `definition.readCallback` (function): Async callback function that returns the resource content

### `mcp.tool(definition)`

Defines a tool that can be called by clients.

**Parameters:**

- `definition.name` (string): Tool name
- `definition.description` (string, optional): Tool description
- `definition.inputs` (array, optional): Input parameters
  - `name` (string): Parameter name
  - `type` (string): Parameter type ('string', 'number', 'boolean', 'object', 'array')
  - `description` (string, optional): Parameter description
  - `required` (boolean, optional): Whether parameter is required
- `definition.cb` (function): Async callback function that processes the tool call

### `mcp.prompt(definition)`

Defines a prompt template.

**Parameters:**

- `definition.name` (string): Prompt name
- `definition.description` (string, optional): Prompt description
- `definition.args` (array, optional): Prompt arguments (same structure as tool inputs)
- `definition.cb` (function): Async callback function that generates the prompt content

### `mcp.template(definition)`

Defines a resource template with parameterized URIs.

**Parameters:**

- `definition.uriTemplate` (string): URI template with `{parameter}` placeholders
- `definition.name` (string, optional): Template name
- `definition.description` (string, optional): Template description
- `definition.mimeType` (string, optional): MIME type
- `definition.readCallback` (function): Async callback function that processes template parameters

### `mcp.serve()`

Starts the MCP server. Returns a Promise that resolves when the server is running.

## Examples

### File System Server

```typescript
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { create } from 'mcp-use/server'

const mcp = create('filesystem-server', {
  version: '1.0.0',
})

// Resource for listing directory contents
mcp.resource({
  uri: 'fs://list',
  name: 'Directory Listing',
  description: 'Lists files in a directory',
  readCallback: async () => {
    const files = await readdir('.')
    return files.join('\n')
  },
})

// Tool for reading files
mcp.tool({
  name: 'read-file',
  description: 'Read the contents of a file',
  inputs: [
    {
      name: 'path',
      type: 'string',
      description: 'File path to read',
      required: true,
    },
  ],
  cb: async ({ path }) => {
    const content = await readFile(path, 'utf-8')
    return content
  },
})

mcp.serve().catch(console.error)
```

### Weather Server

```typescript
import { create } from 'mcp-use/server'

const mcp = create('weather-server', {
  version: '1.0.0',
})

// Weather resource
mcp.resource({
  uri: 'weather://current',
  name: 'Current Weather',
  description: 'Current weather information',
  mimeType: 'application/json',
  readCallback: async () => {
    // In a real implementation, you'd fetch from a weather API
    return JSON.stringify({
      temperature: 22,
      condition: 'sunny',
      humidity: 65,
    })
  },
})

// Weather tool
mcp.tool({
  name: 'get-weather',
  description: 'Get weather for a specific location',
  inputs: [
    {
      name: 'location',
      type: 'string',
      description: 'City or location name',
      required: true,
    },
  ],
  cb: async ({ location }) => {
    // In a real implementation, you'd fetch from a weather API
    return `Weather in ${location}: 22°C, sunny`
  },
})

mcp.serve().catch(console.error)
```

## Advanced Usage

### Custom Transport

The server uses stdio transport by default, but you can extend the `McpServer` class to use different transports:

```typescript
import { WebSocketServerTransport } from '@modelcontextprotocol/sdk/server/websocket.js'
import { McpServer } from 'mcp-use/server'

class CustomMcpServer extends McpServer {
  async serveWithWebSocket(port: number) {
    const transport = new WebSocketServerTransport(port)
    await this.server.connect(transport)
  }
}
```

### Error Handling

```typescript
mcp.tool({
  name: 'risky-operation',
  description: 'An operation that might fail',
  cb: async ({ input }) => {
    try {
      // Some operation that might fail
      const result = await someRiskyOperation(input)
      return `Success: ${result}`
    } catch (error) {
      return `Error: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    }
  },
})
```

## TypeScript Support

The library provides full TypeScript support with proper type inference:

```typescript
import type {
  PromptDefinition,
  ResourceDefinition,
  ServerConfig,
  ToolDefinition,
} from 'mcp-use/server'

const config: ServerConfig = {
  name: 'my-server',
  version: '1.0.0',
  description: 'My server',
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
