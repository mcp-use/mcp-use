# Lore Context Memory Server Example

An MCP server that wraps the [Lore Context](https://lorecontext.com) REST API, exposing three tools for persistent agent memory: search, write, and get.

## Tools

| Tool | Description | Annotations |
| --- | --- | --- |
| `memory_search` | Semantic search across memories | read-only |
| `memory_write` | Persist a new memory with scope and type | write |
| `memory_get` | Retrieve a single memory by ID | read-only |

## Setup

1. Copy `.env.example` to `.env` and fill in your Lore Context API key:

```bash
cp .env.example .env
```

2. Install dependencies (from the monorepo root):

```bash
pnpm install
```

3. Run in development mode:

```bash
pnpm dev
```

The server starts at `http://localhost:3000` with the MCP Inspector at `/inspector`.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `LORE_API_BASE_URL` | `https://api.lorecontext.com/v1` | Base URL for the Lore Context REST API |
| `LORE_API_KEY` | _(none)_ | API key for authentication |
| `PORT` | `3000` | Port to listen on |

## Usage with MCP Clients

Add this server to your MCP client configuration:

```json
{
  "mcpServers": {
    "lore-context": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## License

MIT
