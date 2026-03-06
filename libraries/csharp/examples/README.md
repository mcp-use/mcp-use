# MCP-Use C# Examples

This directory contains example applications demonstrating various features of the MCP-Use C# library.

**All examples use pure C# MCP servers** - no Node.js or Python required!

## Prerequisites

- .NET 8.0 SDK
- API keys for LLM providers (OpenAI, Anthropic, etc.)

## Examples

### Basic Examples

| Example | Description |
|---------|-------------|
| [BasicAgent](./BasicAgent) | Simple interactive agent with tool access |
| [StreamingAgent](./StreamingAgent) | Agent with streaming output |
| [ChatExample](./ChatExample) | Interactive chat with memory |
| [MultiServerExample](./MultiServerExample) | Using multiple MCP servers |
| [StreamingExample](./StreamingExample) | Real-time streaming output |
| [StructuredOutputExample](./StructuredOutputExample) | Typed JSON responses |

### Advanced Examples

| Example | Description |
|---------|-------------|
| [ServerManagerExample](./ServerManagerExample) | Dynamic server management |
| [CodeModeExample](./CodeModeExample) | Code execution mode |
| [MiddlewareExample](./MiddlewareExample) | Request/response pipelines |
| [TelemetryExample](./TelemetryExample) | Observability integration |

### Integration Examples

| Example | Description |
|---------|-------------|
| [OpenAIIntegrationExample](./OpenAIIntegrationExample) | OpenAI adapter usage |
| [AnthropicIntegrationExample](./AnthropicIntegrationExample) | Anthropic Claude adapter |

### Server Examples

| Example | Description |
|---------|-------------|
| [ServerExample](./ServerExample) | MCP server with calculator, weather, notes |
| [FileSystemServer](./FileSystemServer) | MCP server with file system operations |

## Running Examples

### Set Environment Variables

```bash
# Required for most examples
export OPENAI_API_KEY=your_openai_key

# Required for Anthropic examples
export ANTHROPIC_API_KEY=your_anthropic_key

# Optional for telemetry
export LANGFUSE_PUBLIC_KEY=your_langfuse_public_key
export LANGFUSE_SECRET_KEY=your_langfuse_secret_key
export APPLICATIONINSIGHTS_CONNECTION_STRING=your_connection_string
```

### Run an Example

```bash
cd examples/ChatExample
dotnet run
```

Or from the solution root:

```bash
dotnet run --project examples/ChatExample/ChatExample.csproj
```

## Example Descriptions

### BasicAgent
Simple interactive agent with tool access. Demonstrates:
- Creating an MCP client from inline configuration
- Using the McpAgent for single-turn queries
- Interactive command-line interface

### StreamingAgent
Agent with real-time streaming output. Demonstrates:
- Streaming responses with `StreamAsync()`
- Using FileSystemServer for file operations
- Real-time token output

### ChatExample
Interactive chat application with conversation memory. Demonstrates:
- Creating an MCP client from configuration
- Using the McpAgent for multi-turn conversations
- Memory persistence across turns

### MultiServerExample
Using multiple MCP servers simultaneously. Demonstrates:
- Configuring multiple servers (Airbnb, Playwright, Filesystem)
- Cross-server queries
- Tool availability from different servers

### StreamingExample
Real-time output with event-based streaming. Demonstrates:
- Text streaming with `StreamAsync()`
- Event streaming with `StreamEventsAsync()`
- Tool call progress tracking

### StructuredOutputExample
Getting typed JSON responses. Demonstrates:
- Defining output schemas
- JSON extraction from responses
- Deserialization to C# records

### ServerManagerExample
Dynamic server management at runtime. Demonstrates:
- Listing available servers and tools
- Server manager tools in agent
- Tool discovery and introspection

### CodeModeExample
AI agents executing code with MCP tool access. Demonstrates:
- CodeModeConnector for script execution
- Roslyn-based C# code execution
- Efficient context usage through code

### MiddlewareExample
Request/response processing pipelines. Demonstrates:
- LoggingMiddleware for debugging
- RateLimitingMiddleware for API protection
- CachingMiddleware for response caching
- ToolFilterMiddleware for security

### TelemetryExample
Observability and monitoring integration. Demonstrates:
- Langfuse integration for LLM observability
- Application Insights for Azure monitoring
- Custom telemetry sinks
- Trace and operation tracking

### OpenAIIntegrationExample
Direct OpenAI adapter usage. Demonstrates:
- OpenAIAdapter for OpenAI SDK integration
- Creating chat clients through adapters
- Model selection and configuration

### AnthropicIntegrationExample
Anthropic Claude adapter usage. Demonstrates:
- Pattern for using different LLM providers with MCP tools
- Using MCP agent with streaming
- Note: Currently uses OpenAI as placeholder until Microsoft.Extensions.AI.Anthropic is available

### ServerExample
Creating custom MCP servers. Demonstrates:
- McpServer for server-side development
- Tool registration with handlers
- Resource registration
- Running as stdio MCP server

## Solution Structure

```
examples/
├── BasicAgent/                 # Simple interactive agent
│   ├── Program.cs
│   └── BasicAgent.csproj
├── StreamingAgent/             # Agent with streaming
│   ├── Program.cs
│   └── StreamingAgent.csproj
├── ServerExample/              # MCP server with calculator, weather, notes tools
│   ├── Program.cs
│   └── ServerExample.csproj
├── FileSystemServer/           # MCP server with file system operations
│   ├── Program.cs
│   └── FileSystemServer.csproj
├── ChatExample/
│   ├── Program.cs
│   └── ChatExample.csproj
├── MultiServerExample/
│   ├── Program.cs
│   └── MultiServerExample.csproj
├── StreamingExample/
│   ├── Program.cs
│   └── StreamingExample.csproj
├── StructuredOutputExample/
│   ├── Program.cs
│   └── StructuredOutputExample.csproj
├── ServerManagerExample/
│   ├── Program.cs
│   └── ServerManagerExample.csproj
├── CodeModeExample/
│   ├── Program.cs
│   └── CodeModeExample.csproj
├── MiddlewareExample/
│   ├── Program.cs
│   └── MiddlewareExample.csproj
├── TelemetryExample/
│   ├── Program.cs
│   └── TelemetryExample.csproj
├── OpenAIIntegrationExample/
│   ├── Program.cs
│   └── OpenAIIntegrationExample.csproj
├── AnthropicIntegrationExample/
│   ├── Program.cs
│   └── AnthropicIntegrationExample.csproj
└── README.md
```

## C# MCP Servers

Unlike Python/TypeScript examples that often use npm packages, **all C# examples use pure C# MCP servers**:

### ServerExample
Provides:
- `calculator` - Basic arithmetic operations (add, subtract, multiply, divide)
- `get_weather` - Simulated weather data for any city
- `save_note` / `get_note` - Note storage and retrieval

### FileSystemServer
Provides:
- `list_directory` - List files and folders
- `read_file` / `write_file` - File I/O operations
- `create_directory` / `delete_file` - File management
- `get_file_info` / `search_files` - File metadata and search

## Feature Parity with Python/TypeScript

This C# library provides 1:1 feature parity with the Python and TypeScript implementations:

| Feature | Python | TypeScript | C# |
|---------|--------|------------|-----|
| MCP Client | ✅ | ✅ | ✅ |
| Agent with tools | ✅ | ✅ | ✅ |
| Memory/History | ✅ | ✅ | ✅ |
| Multi-server | ✅ | ✅ | ✅ |
| Streaming | ✅ | ✅ | ✅ |
| Structured output | ✅ | ✅ | ✅ |
| Server Manager | ✅ | ✅ | ✅ |
| Code Mode | ✅ | ✅ | ✅ |
| Middleware | ✅ | ✅ | ✅ |
| Telemetry | ✅ | ✅ | ✅ |
| OpenAI adapter | ✅ | ✅ | ✅ |
| Anthropic adapter | ✅ | ✅ | ✅ |
| Google adapter | ✅ | ✅ | ✅ |
| MCP Server | ✅ | ✅ | ✅ |
| WebSocket transport | ✅ | ✅ | ✅ |
| SSE transport | ✅ | ✅ | ✅ |
