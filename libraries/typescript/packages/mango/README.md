# @mcp-use/mango

AI Agent for MCP Server Development

## Overview

Mango is a vibe coding agent for MCP Server with Apps SDK support.

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
