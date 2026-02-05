# CLAUDE.md - C# Library

This file provides guidance for working with the C# implementation of mcp-use.

**IMPORTANT:** Read the root `/CLAUDE.md` first for critical workflow requirements around planning, breaking changes, and testing standards.

---

## Project Overview

**mcp-use for C#** is a unified MCP (Model Context Protocol) client and agent library that enables any LLM to connect to MCP servers. Built on top of the official [MCP C# SDK](https://github.com/modelcontextprotocol/csharp-sdk), it provides a high-level interface using `Microsoft.Extensions.AI` for connecting LLMs to MCP tools.

## Development Commands

### Setup

```bash
# Navigate to the library directory
cd libraries/csharp

# Restore dependencies
dotnet restore

# Build
dotnet build

# Run tests
dotnet test
```

### Code Quality

```bash
# Format code
dotnet format

# Run analyzers
dotnet build /p:TreatWarningsAsErrors=true
```

### Testing

```bash
# Run all tests
dotnet test

# Run with coverage
dotnet test --collect:"XPlat Code Coverage"

# Run specific test
dotnet test --filter "FullyQualifiedName~TestClassName"
```

## Architecture Overview

### Core Components

**McpUseClient** (`Client/McpUseClient.cs`)
- Main entry point for MCP server management
- Handles configuration loading from files or dictionaries
- Manages multiple MCP server sessions
- Mirrors Python/TypeScript `MCPClient` API

**McpAgent** (`Agent/McpAgent.cs`)
- High-level agent interface using `Microsoft.Extensions.AI`
- Integrates `IChatClient` with MCP tools
- Supports streaming responses and conversation memory
- Mirrors Python/TypeScript `MCPAgent` API

**McpUseSession** (`Client/McpUseSession.cs`)
- Manages individual MCP server connections
- Wraps the official `McpClient` from the SDK
- Handles tool discovery and resource management

### Key Patterns

**Configuration-Driven Design**: Servers are configured via JSON files or dictionaries with `mcpServers` key containing server definitions (Claude Desktop format).

**Async/Await**: All I/O operations are asynchronous using C# async patterns.

**Microsoft.Extensions.AI Integration**: Tools are exposed via `IChatClient` and `AIFunction`, enabling use with any M.E.AI-compatible LLM.

**Dependency Injection**: Full support for `IServiceCollection` registration.

## Configuration Examples

### Basic Server Configuration

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}
```

### HTTP Server Configuration

```json
{
  "mcpServers": {
    "remote": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

## Testing Guidelines

- Use xUnit for unit tests
- Integration tests should use actual MCP servers where possible
- Mock only external LLM API calls when necessary
- Test both sync and async code paths
