# Lore Context MCP Server

A [mcp-use](https://github.com/mcp-use/mcp-use) server that exposes [Lore Context](https://github.com/Lore-Context/lore-context) semantic memory tools.

## What it does

Lore Context provides persistent, semantically-indexed memory for AI agents. This server wraps its REST API as MCP tools:

| Tool | Description |
|------|-------------|
| `memory_search` | Semantic search across stored memories |
| `memory_write` | Store a new memory with metadata |
| `memory_get` | Read a specific memory by ID |
| `memory_list` | List memories with filters |
| `memory_forget` | Soft-delete a memory |
| `context_query` | Get agent-ready context from multiple sources |

## Setup

### 1. Start a Lore Context server

```bash
# Using Docker
docker run -p 3000:3000 ghcr.io/lore-context/lore-context:latest

# Or install locally
pip install lore-context
lore serve
```

### 2. Configure environment

```bash
export LORE_API_URL=http://localhost:3000
export LORE_API_KEY=your-api-key  # optional
```

### 3. Run the server

```bash
cd libraries/typescript/packages/mcp-use/examples/server/basic/lore-context
npm install
npm run dev
```

The MCP endpoint will be available at `http://localhost:3001/mcp`.

## Use with Claude Desktop

Add to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "lore-context": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LORE_API_URL` | No | `http://localhost:3000` | Lore Context API base URL |
| `LORE_API_KEY` | No | — | API key for authentication |
