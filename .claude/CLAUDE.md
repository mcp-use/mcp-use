# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**mcp-use** is a full-stack MCP (Model Context Protocol) framework providing everything needed to build with MCP: servers, clients, and AI agents. This is a **dual-language monorepo** with separate Python and TypeScript implementations that maintain feature parity while following language-specific idioms.

**Key Components:**
- **MCP Agents** - AI agents that use tools and reason across steps
- **MCP Clients** - Connect any LLM to any MCP server
- **MCP Servers** - Build custom MCP servers (TypeScript)
- **MCP Inspector** - Web-based debugger for MCP servers
- **MCP-UI Resources** - Build ChatGPT apps with interactive widgets (TypeScript)

## Repository Structure

This is a **monorepo** with independent Python and TypeScript implementations:

```
mcp-use/
├── libraries/
│   ├── python/              # Python library (single package: mcp-use)
│   │   ├── mcp_use/         # Core library source
│   │   ├── tests/           # Unit and integration tests
│   │   ├── pyproject.toml   # Python project config
│   │   └── CLAUDE.md        # Python-specific guide
│   │
│   └── typescript/          # TypeScript monorepo (pnpm workspace)
│       ├── packages/
│       │   ├── mcp-use/            # Core framework (agents, clients, servers)
│       │   ├── cli/                # Build tool with hot reload
│       │   ├── inspector/          # Web-based MCP debugger
│       │   └── create-mcp-use-app/ # Project scaffolding CLI
│       ├── package.json            # Workspace configuration
│       └── pnpm-workspace.yaml     # Workspace definition
│
├── docs/                    # Documentation site
├── .github/workflows/       # CI/CD pipelines
└── CONTRIBUTING.md          # Contribution guidelines
```

## Development Commands

### Python Development

**Location**: `libraries/python/`

**Prerequisites**: Python 3.11+, [uv](https://docs.astral.sh/uv/) package manager

```bash
cd libraries/python

# Setup
uv venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
uv pip install -e ".[dev,anthropic,openai,search,e2b]"

# Code Quality
ruff check .              # Check linting
ruff check . --fix        # Fix linting issues
ruff format .             # Format code
ty check                  # Type checking (experimental)

# Testing
pytest tests/unit/                              # Unit tests only
pytest tests/integration/                       # Integration tests
pytest tests/integration/client/transports/     # Transport tests (stdio, sse, http)
pytest tests/integration/client/primitives/     # Primitive tests (tools, resources, prompts)
pytest tests/integration/agent/                 # Agent tests (requires API keys)
pytest --cov=mcp_use --cov-report=html         # Coverage report

# Debug Mode
export DEBUG=2            # Full verbose logging
export MCP_USE_DEBUG=2    # Alternative debug flag
pytest -vv -s tests/unit/test_client.py        # Verbose test output
```

### TypeScript Development

**Location**: `libraries/typescript/`

**Prerequisites**: Node.js 20+ (22 recommended), pnpm 10+

```bash
cd libraries/typescript

# Setup
pnpm install              # Install all workspace dependencies
pnpm build                # Build all packages (mcp-use first, then others)

# Development
pnpm dev                  # Run all packages in parallel dev mode
pnpm --filter mcp-use dev # Run specific package dev mode

# Code Quality
pnpm format               # Format code with Prettier
pnpm format:check         # Check formatting
pnpm lint                 # Lint with ESLint
pnpm lint:fix             # Fix linting issues
pnpm lint:strict          # Lint with zero warnings allowed

# Testing
pnpm test                                       # Run all tests in all packages
pnpm --filter mcp-use test                      # Test core package
pnpm --filter mcp-use test:unit                 # Unit tests only
pnpm --filter mcp-use test:integration:agent    # Agent tests (requires OPENAI_API_KEY)

# Building Specific Packages
pnpm --filter mcp-use build            # Build core library
pnpm --filter @mcp-use/cli build       # Build CLI
pnpm --filter @mcp-use/inspector build # Build inspector

# Changesets (required for all TypeScript PRs)
pnpm changeset            # Create changeset describing changes
pnpm version:check        # Verify changeset status
```

### Testing New Projects

```bash
cd libraries/typescript

# Test scaffolding with different templates
pnpm test_app:starter     # Test starter template
pnpm test_app:apps-sdk    # Test apps-sdk template
pnpm test_app:mcp-ui      # Test mcp-ui template
```

## High-Level Architecture

### Core Architecture Pattern (Both Languages)

Both implementations follow a **layered architecture** with the same conceptual design:

```
┌─────────────────────────────────────────┐
│  Application Layer                      │
│  MCPAgent, MCPServer, RemoteAgent       │
├─────────────────────────────────────────┤
│  Session & Client Layer                 │
│  MCPClient (multi-server manager)       │
│  MCPSession (single server connection)  │
├─────────────────────────────────────────┤
│  Connector Layer (Transport Abstraction)│
│  Stdio, HTTP, WebSocket, Sandbox        │
├─────────────────────────────────────────┤
│  MCP Protocol Layer                     │
│  @modelcontextprotocol/sdk (TS)         │
│  mcp package (Python)                   │
└─────────────────────────────────────────┘
```

### Key Components

**MCPClient** (`client.ts` / `client.py`)
- Central manager for multiple MCP server sessions
- Loads configuration from JSON files or dictionaries
- Handles server lifecycle (create, connect, close)
- Routes tool calls to appropriate servers
- Supports E2B sandbox execution and callbacks

**MCPSession** (`session.ts` / `session.py`)
- Represents a single MCP server connection
- Manages tool/resource/prompt discovery and caching
- Handles connection state and error recovery
- Provides interfaces for calling tools and reading resources

**MCPAgent** (`agents/mcp_agent.ts` / `agents/mcpagent.py`)
- High-level agent interface built on LangChain
- Integrates LLMs with MCP tools for multi-step reasoning
- Supports streaming responses and conversation memory
- Includes observability (Langfuse integration)
- Can use ServerManager for dynamic server selection

**Connectors** (transport abstraction layer)
- **StdioConnector**: Process-based servers (npx, python, etc.)
- **HttpConnector**: HTTP/SSE servers
- **WebSocketConnector**: WebSocket servers
- **SandboxConnector**: E2B sandboxed execution for untrusted code

### Configuration-Driven Server Discovery

Servers are configured declaratively via JSON:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "http_server": {
      "url": "http://localhost:3000/sse"
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"],
      "env": { "DISPLAY": ":1" }
    }
  }
}
```

This enables:
- No code changes to use different servers
- Easy dynamic server loading at runtime
- Integration with config management systems
- Multiple servers working together in one agent

### LangChain Adapter Pattern

Both implementations use an **adapter pattern** to convert MCP tools to LangChain format:

```
MCP Tool (native format)
    ↓
Adapter Layer (LangChainAdapter)
    ↓
LangChain Tool Interface
    ↓
Any LangChain-compatible LLM
```

This design:
- Isolates MCP protocol from AI frameworks
- Enables use with any LangChain LLM (OpenAI, Anthropic, etc.)
- Allows custom adapters for other frameworks
- Handles schema conversion and validation

### TypeScript Monorepo Structure (pnpm workspace)

The TypeScript implementation is a **pnpm workspace monorepo** with these packages:

| Package | Version | Purpose | Key Features |
|---------|---------|---------|--------------|
| **mcp-use** | 1.12.1 | Core framework | Agents, clients, servers, all transports |
| **@mcp-use/cli** | 2.8.1 | Build tool | Hot reload, auto-inspector, Vite integration |
| **@mcp-use/inspector** | 0.14.1 | Web debugger | React UI, test tools, OAuth flows |
| **create-mcp-use-app** | 0.10.0 | Scaffolding CLI | Project templates, interactive setup |

**Key Workspace Features:**
- Shared `node_modules` at root (efficient disk usage)
- Internal packages use `workspace:*` protocol
- `pnpm build` respects dependency order (mcp-use first)
- Version consistency enforced via overrides in root `package.json`

**Critical Overrides** (in `libraries/typescript/package.json`):
```json
{
  "pnpm": {
    "overrides": {
      "@langchain/core": "^1.0.1",
      "react": "^19.2.0",
      "zod": "^4.2.0"
    }
  }
}
```

### Build Systems

**Python**: Uses `hatchling` as build backend
- **Linting/Formatting**: Ruff (replaces black/isort/flake8)
- **Type Checking**: ty (experimental, currently not enforced in CI)
- **Line Length**: 120 characters

**TypeScript**: Uses `tsup` for bundling, `tsc` for declarations
- **Bundler**: tsup with multiple entry points
- **Type Checking**: TypeScript strict mode, composite projects
- **Formatting**: Prettier (line length: 100)
- **Linting**: ESLint with TypeScript plugin

## Testing Strategy

### Python Testing

**Test Organization** (`libraries/python/tests/`):
```
tests/
├── unit/                    # Fast, isolated tests
├── integration/
│   ├── client/
│   │   ├── transports/      # Stdio, SSE, HTTP tests
│   │   ├── primitives/      # Tools, resources, prompts tests
│   │   └── others/          # Other integration tests
│   ├── agent/               # Agent tests (requires API keys)
│   └── servers_for_testing/ # Custom test MCP servers
└── conftest.py              # Shared fixtures
```

**Running Tests**:
```bash
pytest tests/unit/                               # Fast unit tests
pytest tests/integration/client/transports/      # Transport-specific tests
pytest tests/integration/client/primitives/      # MCP primitive tests
pytest tests/integration/agent/                  # Agent tests (needs OPENAI_API_KEY)
```

### TypeScript Testing

**Test Organization** (`libraries/typescript/packages/mcp-use/tests/`):
```
tests/
├── unit/                    # Fast unit tests with vitest
├── integration/             # Integration tests with real servers
├── agents/                  # Agent-specific tests
├── stream_events.test.ts    # Streaming functionality tests
└── servers/                 # Test server definitions
```

**Running Tests**:
```bash
pnpm test                                        # All tests in all packages
pnpm --filter mcp-use test:unit                  # Unit tests only
pnpm --filter mcp-use test:integration:agent     # Agent tests (needs OPENAI_API_KEY)
```

### CI/CD Testing Strategy

The CI pipeline (`ci.yml`) uses **path-based filtering** for efficient testing:

**Python Tests** (triggered on `libraries/python/**` changes):
- Linting (ruff check + format check)
- Unit tests (Python 3.11 & 3.12, matrix of latest/minimum deps)
- Transport tests (stdio, sse, streamable_http)
- Primitive tests (tools, resources, prompts, sampling, logging, roots, completion)
- Agent tests (requires API keys)
- Conformance tests (MCP protocol compliance)

**TypeScript Tests** (triggered on `libraries/typescript/**` changes):
- Linting (ESLint) and formatting (Prettier)
- Build verification (all packages)
- Unit and integration tests
- Agent tests (requires API keys)
- Changeset verification (PRs to main only)
- create-mcp-use-app E2E tests (matrix: 3 OS × 3 package managers × 3 templates)

## Code Style and Conventions

### Python Standards

- **Line Length**: 120 characters (configured in `pyproject.toml`)
- **Python Version**: 3.11+ required
- **Formatting**: Ruff for all formatting and linting
- **Type Hints**: All public APIs should have type hints
- **Async Patterns**: Use async/await consistently for I/O
- **Docstrings**: Google-style format
- **Imports**: Sorted via Ruff (isort rules)

### TypeScript Standards

- **TypeScript**: Strict mode enabled
- **No `any`**: Always define explicit types
- **Interfaces**: Use interfaces for object shapes
- **Const over Let**: Prefer immutability
- **Async/Await**: Preferred over raw promises
- **Exports**: Named exports for all public APIs

### Commit Conventions

While not strictly enforced, we recommend conventional commits:

```
feat(python): add new connector for sandboxed execution
fix(typescript): resolve memory leak in agent streaming
docs: update API documentation for MCPClient
chore(ci): improve test matrix for cross-platform support
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## Important Development Notes

### Multi-Transport Support

The connector abstraction layer enables the same agent/client code to work with different transports:
- **Stdio**: Most common, runs servers as subprocesses
- **HTTP/SSE**: For remote servers or web-based deployments
- **WebSocket**: Real-time bidirectional communication
- **Sandbox (E2B)**: Isolated code execution for untrusted servers

### Configuration Loading

Both implementations support multiple config sources:
1. **From file**: `MCPClient.fromConfig("path/to/config.json")`
2. **From dict**: `MCPClient.fromDict({"mcpServers": {...}})`
3. **Programmatic**: Construct manually with server definitions

### Resource Management

Always properly close sessions to avoid resource leaks:

```python
# Python - use context manager
async with MCPClient.from_dict(config) as client:
    await client.create_all_sessions()
    # ... use client ...
# Automatically closed

# Or manually
client = MCPClient.from_dict(config)
try:
    await client.create_all_sessions()
    # ... use client ...
finally:
    await client.close_all_sessions()
```

```typescript
// TypeScript - manual cleanup
const client = new MCPClient(config);
try {
  await client.createAllSessions();
  // ... use client ...
} finally {
  await client.closeAllSessions();
}
```

### Debugging and Observability

**Python**:
```bash
export DEBUG=2               # Full verbose logging
export MCP_USE_DEBUG=2       # Alternative flag
```

**TypeScript**:
```typescript
// Enable debug logging programmatically
process.env.DEBUG = "mcp:*";
```

**Built-in Observability**:
- PostHog telemetry (can be disabled: `MCP_USE_ANONYMIZED_TELEMETRY=false`)
- Langfuse integration for agent monitoring
- Structured logging with debug levels

### Security Considerations

- **Tool Access Control**: Use `disallowed_tools` parameter to restrict access
- **Sandboxing**: E2B connector for untrusted code execution
- **OAuth Support**: Built-in OAuth flow handling for authenticated servers
- **Environment Variables**: Never commit API keys or secrets

## Common Development Tasks

### Adding a New Connector

1. Extend `BaseConnector` in `mcp_use/connectors/` (Python) or `src/connectors/` (TypeScript)
2. Implement required async methods (`send_message`, `receive_message`, `close`)
3. Add connector to factory/config loader
4. Write integration tests with custom test server
5. Update documentation

### Working with the Inspector (TypeScript only)

The inspector is automatically available when using `server.listen()`:

```typescript
import { MCPServer } from "mcp-use/server";

const server = new MCPServer({ name: "my-server" });
server.listen(3000);
// Inspector available at: http://localhost:3000/inspector
```

Or run standalone:
```bash
npx @mcp-use/inspector --url http://localhost:3000/sse
```

### Creating New MCP Servers (TypeScript only)

Use the scaffolding tool:
```bash
npx create-mcp-use-app my-server
cd my-server
pnpm install
pnpm dev  # Auto-starts with inspector
```

### Adding Tests for New Features

**Python**:
- Unit tests go in `tests/unit/`
- Integration tests in appropriate `tests/integration/` subdirectory
- Use fixtures from `conftest.py`
- Create custom test servers in `tests/integration/servers_for_testing/`

**TypeScript**:
- Use vitest for all tests
- Follow existing test patterns in `tests/`
- Mock external dependencies in unit tests
- Use real MCP servers for integration tests

### Changesets (TypeScript Only)

**All TypeScript PRs require a changeset**:

```bash
cd libraries/typescript
pnpm changeset
# Select affected packages
# Choose semver bump (patch/minor/major)
# Write summary of changes
# Commit generated .changeset/*.md file
```

This is enforced in CI for PRs to `main`.

## Pre-commit Hooks

**Python** (`.pre-commit-config.yaml` in `libraries/python/`):
- Ruff linting and formatting
- Type checking with ty (excluding tests)
- Trailing whitespace and EOF fixes

Setup:
```bash
cd libraries/python
pre-commit install
pre-commit run --all-files
```

**TypeScript** (Husky + lint-staged):
- Prettier formatting on staged files
- ESLint fixing on staged files
- Automatically runs on `git commit`

Setup: Automatic via `pnpm install` (runs `prepare` script)

## Release Process

### Python Release

1. Update version in `pyproject.toml`
2. Ensure all tests pass
3. Tag release: `git tag python-v1.x.x`
4. GitHub Action automatically publishes to PyPI

### TypeScript Release

1. Create changesets for all changes: `pnpm changeset`
2. Merge to `main`
3. Changesets bot creates "Version Packages" PR
4. Merge version PR
5. GitHub Action automatically publishes to npm

## Additional Resources

- **Python Library**: See `libraries/python/CLAUDE.md` for Python-specific details
- **Contributing Guide**: See `CONTRIBUTING.md` for detailed contribution guidelines
- **Online Docs**: [docs.mcp-use.com](https://docs.mcp-use.com)
- **Discord**: [discord.gg/XkNkSkMz3V](https://discord.gg/XkNkSkMz3V)
- **GitHub Issues**: [github.com/mcp-use/mcp-use/issues](https://github.com/mcp-use/mcp-use/issues)
