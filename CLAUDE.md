# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**mcp-use** is a unified MCP (Model Context Protocol) client library that enables any LLM to connect to MCP servers and build custom agents with tool access. The library provides a high-level Python interface for connecting LangChain-compatible LLMs to MCP tools like web browsing, file operations, and more.

## Development Commands

### Setup

```bash
# Activate virtual environment (if it exists)
source env/bin/activate

# Create virtual environment if it doesn't exist
# python -m venv env && source env/bin/activate

# Install for development
pip install -e ".[dev,search]"

# Install with optional dependencies
pip install -e ".[dev,anthropic,openai,e2b,search]"
```

### Code Quality

```bash
# Run linting and formatting
ruff check --fix
ruff format

# Run type checking
mypy mcp_use/

# Run pre-commit hooks
pre-commit run --all-files
```

### Testing

```bash
# Run all tests
pytest

# Run specific test types
pytest tests/unit/          # Unit tests only
pytest tests/integration/   # Integration tests only

# Run with coverage
pytest --cov=mcp_use --cov-report=html

# Run specific test file
pytest tests/unit/test_client.py

# Run with debug output
DEBUG=2 pytest tests/unit/test_client.py -v -s
```

### Local Development

```bash
# Debug mode environment variable
export DEBUG=1  # INFO level
export DEBUG=2  # DEBUG level (full verbose)

# Or set MCP_USE_DEBUG
export MCP_USE_DEBUG=2
```

## Architecture Overview

### Core Components

**MCPClient** (`mcp_use/client.py`)

- Main entry point for MCP server management
- Handles configuration loading from files or dictionaries
- Manages multiple MCP server sessions
- Supports sandboxed execution via E2B

**MCPAgent** (`mcp_use/agents/mcpagent.py`)

- High-level agent interface using LangChain's agent framework
- Integrates LLMs with MCP tools
- Supports streaming responses and conversation memory
- Can use ServerManager for dynamic server selection

**MCPSession** (`mcp_use/session.py`)

- Manages individual MCP server connections
- Handles tool discovery and resource management
- Maintains connection state and lifecycle

**Connectors** (`mcp_use/connectors/`)

- Abstraction layer for different MCP transport protocols
- `StdioConnector`: Process-based MCP servers
- `HttpConnector`: HTTP-based MCP servers
- `WebSocketConnector`: WebSocket-based MCP servers
- `SandboxConnector`: E2B sandboxed execution

**ServerManager** (`mcp_use/managers/server_manager.py`)

- Provides dynamic server selection capabilities
- Allows agents to choose appropriate servers for tasks
- Manages server tool discovery and activation

### Key Patterns

**Configuration-Driven Design**: Servers are configured via JSON files or dictionaries with `mcpServers` key containing server definitions.

**Async/Await**: All I/O operations are asynchronous using asyncio patterns.

**LangChain Integration**: Tools are converted to LangChain format via adapters, enabling use with any LangChain-compatible LLM.

**Multi-Transport Support**: Supports stdio, HTTP, WebSocket, and sandboxed connections to MCP servers.

**Telemetry**: Built-in telemetry using PostHog and Scarf.sh for usage analytics (can be disabled).

## Configuration Examples

### Basic Server Configuration

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"],
      "env": { "DISPLAY": ":1" }
    }
  }
}
```

### HTTP Server Configuration

```json
{
  "mcpServers": {
    "http_server": {
      "url": "http://localhost:8931/sse"
    }
  }
}
```

### Multi-Server Configuration

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    },
    "airbnb": {
      "command": "npx",
      "args": ["-y", "@openbnb/mcp-server-airbnb"]
    }
  }
}
```

## Code Style and Standards

- **Line Length**: 200 characters (configured in ruff.toml)
- **Python Version**: 3.11+ required
- **Formatting**: Use Ruff for formatting and linting
- **Type Hints**: All public APIs should have type hints
- **Async Patterns**: Use async/await consistently for I/O operations
- **Error Handling**: Proper exception handling with logging
- **Documentation**: Docstrings follow Google style

## Testing Strategy

### Unit Tests (`tests/unit/`)

- Test individual components in isolation
- Mock external dependencies
- Focus on business logic and edge cases

### Integration Tests (`tests/integration/`)

- Test component interactions
- Include real MCP server integrations
- Organized by transport type (stdio, sse, websocket, etc.)
- Custom test servers in `tests/integration/servers_for_testing/`

### Test Configuration

- Uses pytest with asyncio mode
- Fixtures defined in `conftest.py`
- Test servers provide controlled MCP environments

## Important Development Notes

- **Environment Setup**: Requires Python 3.11+ and appropriate LangChain provider packages
- **MCP Protocol**: Built on Model Context Protocol specification
- **LangChain Compatibility**: Only models with tool calling capabilities are supported
- **Resource Management**: Always properly close sessions to avoid resource leaks
- **Debugging**: Use DEBUG environment variable or `mcp_use.set_debug()` for verbose logging
- **Memory Management**: MCPAgent supports conversation memory for context retention
- **Security**: Tool access can be restricted via `disallowed_tools` parameter

## Common Development Tasks

### Adding a New Connector

1. Extend `BaseConnector` in `mcp_use/connectors/`
2. Implement required async methods
3. Add connector to factory in `config.py`
4. Write integration tests

### Adding New Agent Features

1. Modify `MCPAgent` class in `mcp_use/agents/mcpagent.py`
2. Update system prompt templates if needed
3. Add comprehensive tests
4. Update documentation

### Testing with Custom MCP Servers

1. Create test server in `tests/integration/servers_for_testing/`
2. Add integration test in appropriate transport directory
3. Use custom servers for controlled testing scenarios
