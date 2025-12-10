# @mcp-use/mango 🥭

AI agent for creating and editing MCP servers live through the inspector.

## Overview

Mango is a specialized AI agent that helps you create, edit, and test MCP (Model Context Protocol) servers directly from the MCP Inspector. It provides an interactive chat interface where you can describe what you want to build, and Mango will:

- Scaffold new MCP servers using templates
- Edit server files with intelligent code generation
- Install dependencies automatically
- Start and test servers
- Debug issues and iterate on implementations

## Features

- 🚀 **Quick Server Creation**: Scaffold MCP servers using `create-mcp-use-app` templates
- 📝 **File Operations**: Read, write, and edit server files with security restrictions
- 🔧 **Tool Development**: Create and test MCP tools, resources, and prompts
- 🧪 **Live Testing**: Start servers and test tools immediately
- 🔄 **Auto-Connection**: Created servers automatically connect to the inspector
- 🤖 **AI-Powered**: Uses LLMs (OpenAI, Anthropic, Google) to understand and implement requirements

## Installation

### In Your Project

```bash
npm install @mcp-use/mango
# or
yarn add @mcp-use/mango
# or
pnpm add @mcp-use/mango
```

### In MCP Inspector

Mango is integrated into the MCP Inspector. Simply click the 🥭 button in the bottom-right corner to start using it.

## Usage

### In the Inspector

1. Open the MCP Inspector
2. Click the 🥭 Mango button in the bottom-right corner
3. Configure your LLM API key (reuses ChatTab configuration)
4. Start chatting with Mango!

Example prompts:
- "Create a weather MCP server with a get_weather tool"
- "Add a new tool to calculate fibonacci numbers"
- "Fix the error in my server's index.ts file"
- "Start my server and test the weather tool"

### Programmatic Usage

#### Server-Side (Node.js)

```typescript
import { MangoAgent } from '@mcp-use/mango/server';
import { WorkspaceManager } from '@mcp-use/mango/server';
import { ChatOpenAI } from '@langchain/openai';

// Create workspace manager
const workspaceManager = new WorkspaceManager({
  workspaceDir: '~/mcp-servers', // optional, defaults to ~/mcp-servers
});

// Create Mango agent
const agent = new MangoAgent({
  llm: new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o',
  }),
  workspaceManager,
  maxSteps: 15,
});

// Initialize the agent
await agent.initialize();

// Ask Mango to create a server
const response = await agent.run(
  'Create a weather MCP server with a get_weather tool that takes a city parameter'
);

console.log(response);

// Clean up
await agent.close();
```

#### API Routes (Hono)

```typescript
import { Hono } from 'hono';
import { registerMangoRoutes } from '@mcp-use/mango/server';

const app = new Hono();

// Register Mango routes
registerMangoRoutes(app, {
  workspaceDir: process.env.MANGO_WORKSPACE_DIR,
  basePath: '/mango', // optional, defaults to /mango
});

// Mango endpoints are now available:
// POST /mango/chat/stream - Streaming chat
// POST /mango/chat - Non-streaming chat
// GET /mango/workspace/projects - List projects
// GET /mango/servers - List running servers
```

#### Client-Side (React)

```typescript
import { MangoButton, MangoChat } from '@mcp-use/mango/client';
import { useState } from 'react';

function App() {
  const [isMangoOpen, setIsMangoOpen] = useState(false);

  return (
    <>
      <MangoButton onClick={() => setIsMangoOpen(true)} />
      
      {isMangoOpen && (
        <MangoChat
          onClose={() => setIsMangoOpen(false)}
          llmConfig={{
            provider: 'openai',
            apiKey: 'your-api-key',
          }}
          onServerCreated={(serverUrl, projectName) => {
            console.log(`Server ${projectName} created at ${serverUrl}`);
          }}
        />
      )}
    </>
  );
}
```

## Architecture

### Package Structure

```
@mcp-use/mango/
├── src/
│   ├── agent/              # AI agent implementation
│   │   ├── mango-agent.ts  # Main agent class
│   │   ├── prompts.ts      # System prompts
│   │   └── tools/          # Agent tools
│   ├── server/             # Server-side code
│   │   ├── routes.ts       # API routes
│   │   ├── workspace.ts    # Workspace management
│   │   └── process-manager.ts
│   ├── client/             # React components
│   │   ├── components/     # UI components
│   │   └── hooks/          # React hooks
│   └── types.ts            # Shared types
```

### Agent Tools

Mango has access to the following tools:

- **create_mcp_server**: Create new MCP servers from templates
- **read_file**: Read file contents from projects
- **write_file**: Write or update files
- **list_files**: List files in project directories
- **install_dependencies**: Install npm packages
- **start_server**: Start MCP servers
- **stop_server**: Stop running servers
- **test_mcp_tool**: Test server tools
- **list_server_tools**: List server capabilities

## Configuration

### Environment Variables

- `MANGO_WORKSPACE_DIR`: Custom workspace directory (default: `~/mcp-servers`)
- `OPENAI_API_KEY`: OpenAI API key (if using OpenAI)
- `ANTHROPIC_API_KEY`: Anthropic API key (if using Anthropic)

### Workspace Management

Mango creates and manages MCP servers in a workspace directory:

- Default location: `~/mcp-servers`
- Each project gets its own subdirectory
- Security: All file operations are restricted to the workspace
- Auto-cleanup: No node_modules or hidden files in listings

## Security

Mango implements several security measures:

- **Path Validation**: All file paths are validated to prevent traversal attacks
- **Workspace Isolation**: File operations restricted to workspace directory
- **Name Validation**: Project names must be alphanumeric (plus hyphens/underscores)
- **Process Management**: Server processes are tracked and can be stopped
- **No Command Injection**: Uses `execa` with safe parameter passing

## Development

### Building

```bash
# Build the package
pnpm build

# Watch mode
pnpm dev
```

### Testing

```bash
# Run tests (coming soon)
pnpm test
```

### Type Checking

```bash
pnpm type-check
```

## API Reference

### MangoAgent

Main agent class for interacting with Mango.

```typescript
class MangoAgent {
  constructor(config: MangoAgentConfig);
  initialize(): Promise<void>;
  run(query: string): Promise<string>;
  stream(query: string): AsyncGenerator;
  streamEvents(query: string): AsyncGenerator;
  getConversationHistory(): BaseMessage[];
  clearConversationHistory(): void;
  close(): Promise<void>;
}
```

### WorkspaceManager

Manages workspace directories and project files.

```typescript
class WorkspaceManager {
  constructor(config?: WorkspaceConfig);
  getWorkspaceDir(): string;
  createProjectDir(name: string): string;
  getProjectPath(name: string): string;
  listProjects(): ProjectInfo[];
  getProjectInfo(name: string): ProjectInfo | null;
  validateFilePath(projectName: string, relativePath: string): string;
}
```

### ProcessManager

Tracks and manages running server processes.

```typescript
class ProcessManager {
  static getInstance(): ProcessManager;
  registerServer(projectName: string, childProcess: ChildProcess, port: number): void;
  stopServer(projectName: string): boolean;
  getServerInfo(projectName: string): ServerProcess | null;
  isServerRunning(projectName: string): boolean;
  getRunningServers(): ServerProcess[];
}
```

## Templates

Mango supports three templates for server creation:

### starter

Full-featured template with:
- Example tools
- mcp-ui resources (React components)
- OpenAI Apps SDK integration
- Comprehensive documentation

### mcp-ui

Focused on mcp-ui resources:
- React component examples
- Rich UI capabilities
- Client-side rendering

### apps-sdk

OpenAI Apps SDK focused:
- Apps SDK metadata
- Widget integration
- OpenAI ChatGPT compatibility

## Examples

### Create a Calculator Server

```typescript
const response = await agent.run(`
  Create a calculator MCP server with the following tools:
  - add(a, b): Add two numbers
  - subtract(a, b): Subtract b from a
  - multiply(a, b): Multiply two numbers
  - divide(a, b): Divide a by b
`);
```

### Debug and Fix Issues

```typescript
const response = await agent.run(`
  My weather server is giving an error when I call the get_weather tool.
  Can you check the code and fix it?
`);
```

### Add New Features

```typescript
const response = await agent.run(`
  Add a new tool to my existing calculator server that calculates
  the factorial of a number
`);
```

## Contributing

Contributions are welcome! Please check out the [mcp-use repository](https://github.com/mcp-use/mcp-use) for guidelines.

## License

MIT

## Links

- [MCP Documentation](https://modelcontextprotocol.io)
- [mcp-use Documentation](https://docs.mcp-use.com)
- [GitHub Repository](https://github.com/mcp-use/mcp-use)
- [Issues](https://github.com/mcp-use/mcp-use/issues)

---

Made with 🥭 by the mcp-use team
