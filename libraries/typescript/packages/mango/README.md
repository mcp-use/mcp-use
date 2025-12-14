# Mango Agent

Mango is an AI agent that builds and tests MCP servers in isolated E2B sandboxes. It uses a two-phase approach:

1. **Phase 1: Build** - The agent builds/edits the MCP server in an E2B sandbox
2. **Phase 2: Test** - The agent tests the MCP server using the MCP connector

## Features

- 🤖 AI-powered MCP server development
- 🏗️ Two-phase execution (build then test)
- 🔒 Isolated E2B sandbox environment
- 📡 Real-time streaming via Redis
- 💬 React-based chat interface
- 🔌 MCP connector integration

## Prerequisites

- Node.js 20+
- E2B API key
- Anthropic API key

## Installation

```bash
pnpm install
```

## Environment Variables

Create a `.env` file:

```env
E2B_API_KEY=your_e2b_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
E2B_TEMPLATE_ID=mcp-use-mango-apps-sdk
PORT=3001
```

## Building the E2B Template

First, build the E2B template:

```bash
cd scripts
chmod +x create-e2b-template.sh
./create-e2b-template.sh
```

This will create an E2B template with:
- Pre-installed Node.js 20
- Pre-installed Anthropic Agent SDK
- Pre-scaffolded MCP project (apps-sdk template)
- All dependencies installed

Copy the template ID from the output and update your `.env` file.

## Development

Start the server and client:
```bash
pnpm dev
```

This will start:
- Server on `http://localhost:3001`
- Client on `http://localhost:5173`

## Usage

1. Open the client at `http://localhost:5173`
2. Send a message describing the MCP server you want to build
3. Watch as the agent:
   - Creates/edits the MCP server (Phase 1)
   - Starts the MCP server
   - Tests it with the MCP connector (Phase 2)

## Architecture

```
User → React Client → Chat API → E2B Sandbox → Anthropic Agent SDK
                                    ↓
                              MCP Server (Phase 2)
                                    ↓
                              SSE Stream → Client
```

## Project Structure

```
mango/
├── src/
│   ├── server/          # Backend API server
│   │   ├── index.ts     # Main server entry
│   │   ├── routes/      # API routes
│   │   └── redis-stream.ts  # Redis streaming
│   └── client/          # React Vite client
├── scripts/
│   ├── e2b.Dockerfile   # E2B template definition
│   └── create-e2b-template.sh  # Template build script
└── README.md
```

## License

MIT

