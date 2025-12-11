# @mcp-use/mango

AI Agent for MCP Server Development

## Overview

Mango is a standalone CLI tool that provides an AI-powered development environment for creating and testing MCP servers. It features:

- **Claude Agent SDK Integration**: Powered by Claude for intelligent server development
- **Visual Canvas**: React Flow-based canvas displaying MCP primitives (tools, resources, prompts, widgets)
- **Chat Interface**: Interactive chat to guide the agent through server creation and testing
- **Auto-Testing**: Automatically connects to servers and recursively tests/improves them

## Usage

```bash
npx @mcp-use/mango
```

This will start the Mango web UI at `http://localhost:5175`.

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build
pnpm build
```

## Architecture

```
src/
├── cli.ts              # CLI entry point
├── server/             # Hono backend
├── agent/              # Claude Agent SDK integration
└── client/             # React frontend
    ├── components/
    │   ├── chat/       # Chat interface
    │   └── canvas/     # React Flow canvas
    └── context/        # Global state
```

## License

MIT
