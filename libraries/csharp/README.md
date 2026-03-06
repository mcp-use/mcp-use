# McpUse for C# / .NET

Full Stack MCP (Model Context Protocol) framework for C#. Build MCP agents, clients, and servers with ease. **100% feature parity with Python and TypeScript libraries.**

Built on top of the [official MCP C# SDK](https://github.com/modelcontextprotocol/csharp-sdk) and follows [Microsoft's security guidelines](https://aka.ms/mcpsec) for MCP servers.

## Features

### 🤖 Agent Framework
- **McpAgent** - High-level AI agent with automatic tool calling, streaming, and conversation memory
- **ServerManager** - Dynamic server selection with management tools (ListServers, ConnectServer, SearchTools, etc.)
- **RemoteAgent** - Cloud-hosted agent execution via mcp-use.com API
- **CodeMode** - Code execution sandbox with access to MCP tools (C# scripting via Roslyn)
- **CodeExecutor** - Execute C# code with MCP tool access, timeout support, and output capture

### 📡 Client Infrastructure
- **McpUseClient** - Multi-server client management with Claude Desktop config support
- **McpUseSession** - Single server connection wrapper with tool/resource/prompt access
- **ConfigLoader** - Claude Desktop JSON format configuration loader

### 🔗 Connectors (Transport Layer)
- **StdioConnector** - Standard I/O transport for local MCP servers (child processes)
- **HttpConnector** - HTTP transport with Server-Sent Events (SSE) for remote servers
- **WebSocketConnector** - WebSocket transport with auto-reconnection and JSON-RPC support
- **SandboxConnector** - E2B/Docker sandbox execution for secure remote code

### 🔐 Authentication
- **OAuth 2.0** - Full OAuth implementation with PKCE, Dynamic Client Registration
- **BearerAuth** - Simple bearer token authentication
- **OAuthCallbackServer** - Local HTTP server for OAuth redirect handling
- **TokenStorage** - File-based and in-memory token persistence

### 📡 Task Managers
- **SseConnectionManager** - Manages Server-Sent Events connections with retry
- **StreamableHttpConnectionManager** - Bidirectional HTTP streaming for MCP

### 🛡️ Enterprise Security (Microsoft Guidelines)
- **TokenValidator** - JWT token validation with audience, issuer, and scope verification
- **SecureSecretsManager** - Azure Key Vault integration for secrets management
- **SecurityEventLogger** - Audit logging for authentication and authorization events
- **Rate limiting middleware** - Configurable request throttling

### 🔌 LLM Adapters
- **OpenAI Adapter** - Convert MCP tools to OpenAI function calling format
- **Anthropic Adapter** - Convert MCP tools to Claude tool format
- **Google Adapter** - Convert MCP tools to Gemini function calling format

### 📊 Observability
- **TelemetryService** - Pluggable telemetry collection system
- **LangfuseSink** - Langfuse integration for LLM observability
- **ApplicationInsightsSink** - Azure Application Insights integration
- **StreamEvents** - Granular streaming events (AgentStart, LlmToken, ToolEnd, etc.)
- **ObservabilityManager** - Callback-based observability for runs, steps, tools, LLM calls
- **LangfuseCallback** - Native Langfuse integration with traces and spans
- **LaminarCallback** - Laminar.ai integration for LLM analytics
- **ConsoleLoggingCallback** - Debug logging to console

### 🔧 Middleware System
- **MiddlewareManager** - Request/response middleware chain
- **LoggingMiddleware** - Request/response logging
- **RateLimitingMiddleware** - Per-connection rate limiting
- **ToolFilterMiddleware** - Allow/block list for tools
- **CachingMiddleware** - Tool result caching

### 🖥️ Server Framework
- **McpServer** - High-level server wrapper with tool/resource/prompt registration
- Multiple transport support (stdio, SSE/HTTP, WebSocket)
- Built-in security middleware integration

## Installation

```bash
dotnet add package McpUse
```

## Quick Start

### Basic Agent

```csharp
using McpUse.Client;
using McpUse.Agent;
using Microsoft.Extensions.AI;
using OpenAI;

// Create client from Claude Desktop config
var client = await McpUseClient.FromConfigFileAsync();

// Create OpenAI chat client
var openAI = new OpenAIClient(Environment.GetEnvironmentVariable("OPENAI_API_KEY")!);
IChatClient chatClient = openAI.GetChatClient("gpt-4o").AsIChatClient();

// Create agent (chatClient first, then mcpClient)
var agent = new McpAgent(chatClient, client);

// Run the agent
var result = await agent.RunAsync("List all files in the current directory");
Console.WriteLine(result);
```

### Streaming Agent

```csharp
var agent = new McpAgent(chatClient, client, new McpAgentOptions
{
    MaxSteps = 10,
    MemoryEnabled = true
});

await foreach (var chunk in agent.StreamAsync("Analyze this codebase"))
{
    Console.Write(chunk);
}
```

### Server Manager for Dynamic Server Selection

```csharp
using McpUse.Managers;

var manager = new ServerManager(client);
await manager.InitializeAsync();

// Agent can now discover and connect to servers dynamically
var functions = await manager.GetAllFunctionsAsync();

// Connect to a specific server
await manager.ConnectToServerAsync("github");

// Search for tools across all servers
var results = await manager.SearchToolsAsync("file operations");
```

### Remote Agent (Cloud Execution)

```csharp
using McpUse.Remote;

var remoteAgent = new RemoteAgent(
    agentId: "your-agent-id",
    apiKey: Environment.GetEnvironmentVariable("MCP_USE_API_KEY"));

var result = await remoteAgent.RunAsync("Analyze market trends");
Console.WriteLine(result);
```

### Code Mode (Script Execution)

```csharp
using McpUse.CodeMode;

var codeMode = new CodeModeConnector(client);
await codeMode.InitializeAsync();

var result = await codeMode.ExecuteCodeAsync(@"
    var tools = await search_tools(""github"");
    WriteLine($""Found {tools.Count} tools"");
    return tools;
");

Console.WriteLine(result.Output);
```

### Enterprise Security with Entra ID

```csharp
using McpUse.Security;

var securityOptions = new EntraIdOptions
{
    TenantId = "your-tenant-id",
    ClientId = "your-client-id",
    Audience = "api://your-mcp-server"
};

var tokenValidator = new TokenValidator(securityOptions);
var result = await tokenValidator.ValidateTokenAsync(bearerToken);

if (!result.IsValid)
{
    throw new McpAuthenticationException(result.ErrorMessage);
}
```

### Connectors (Transport Layer)

```csharp
using McpUse.Connectors;

// Stdio connector for local servers
var stdioConnector = new StdioConnector("dotnet", new[] { "run", "--project", "MyServer" });
await stdioConnector.ConnectAsync();

// HTTP connector with SSE for remote servers
var httpConnector = new HttpConnector("https://api.example.com/mcp", auth: new BearerAuth("token"));
await httpConnector.ConnectAsync();

// Sandbox connector for secure execution (E2B or Docker)
var sandboxConnector = new SandboxConnector(
    "npx", new[] { "-y", "@playwright/mcp" },
    options: new SandboxOptions { Provider = SandboxProviderType.E2B });
await sandboxConnector.ConnectAsync();
```

### OAuth 2.0 Authentication

```csharp
using McpUse.Auth;

// OAuth with PKCE and Dynamic Client Registration
var oauth = new OAuth(new OAuthConfig
{
    ServerUrl = "https://auth.example.com",
    ClientId = "my-client-id",  // Optional if DCR is supported
    Scope = "mcp:read mcp:write",
    RedirectUri = "http://localhost:8765/callback"
});

// Use with HTTP connector
var connector = new HttpConnector("https://api.example.com/mcp", auth: oauth);
await connector.ConnectAsync();  // Opens browser for OAuth flow
```

### Observability Callbacks

```csharp
using McpUse.Observability;

// Create observability manager with callbacks
var observability = new ObservabilityManager();

// Add Langfuse for LLM tracing
observability.AddCallback(new LangfuseCallback(
    publicKey: Environment.GetEnvironmentVariable("LANGFUSE_PUBLIC_KEY"),
    secretKey: Environment.GetEnvironmentVariable("LANGFUSE_SECRET_KEY")));

// Add console logging for debugging
observability.AddCallback(new ConsoleLoggingCallback(verbose: true));

// Use with agent
var agent = new McpAgent(client, chatClient, new McpAgentOptions
{
    Observability = observability
});
```

### Middleware Pipeline

```csharp
using McpUse.Middleware;

var middleware = new MiddlewareManager()
    .Use(new LoggingMiddleware(logger))
    .Use(new RateLimitingMiddleware(maxRequestsPerMinute: 60))
    .Use(new ToolFilterMiddleware(blockedTools: new[] { "dangerous_tool" }))
    .Use(new CachingMiddleware(TimeSpan.FromMinutes(5)));
```

### Creating an MCP Server

```csharp
using McpUse.Server;

var server = new McpServer(new McpServerOptions
{
    Name = "my-server",
    Version = "1.0.0",
    Transport = "stdio"
});

server.AddTool(new ToolDefinition
{
    Name = "get_weather",
    Description = "Get weather for a location",
    InputSchema = JsonDocument.Parse(@"{""type"":""object"",""properties"":{""location"":{""type"":""string""}}}").RootElement,
    Handler = async (args, ct) =>
    {
        var location = args["location"]?.ToString();
        return new { temperature = 72, condition = "sunny", location };
    }
});

await server.RunAsync();
```

### LLM Adapters

```csharp
using McpUse.Adapters;

// OpenAI format
var openaiAdapter = new OpenAIAdapter();
await openaiAdapter.CreateAllAsync(client);
var openaiTools = openaiAdapter.Tools; // Ready for OpenAI API

// Anthropic format
var anthropicAdapter = new AnthropicAdapter();
await anthropicAdapter.CreateAllAsync(client);
var claudeTools = anthropicAdapter.Tools; // Ready for Claude API

// Google format
var googleAdapter = new GoogleAdapter();
await googleAdapter.CreateAllAsync(client);
var geminiTools = googleAdapter.Tools; // Ready for Gemini API
```

### Telemetry & Observability

```csharp
using McpUse.Telemetry;

var telemetry = new TelemetryService(new TelemetryOptions
{
    Enabled = true,
    Langfuse = new LangfuseOptions
    {
        PublicKey = "pk-xxx",
        SecretKey = "sk-xxx"
    }
});

// Auto-track operations
await using var operation = telemetry.StartOperation("agent_run");
operation.WithProperty("query", userQuery);
// ... do work ...
// Operation duration automatically captured on dispose
```

## Configuration

McpUse supports Claude Desktop configuration format:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "your-token"
      }
    },
    "remote-api": {
      "url": "https://api.example.com/mcp",
      "transport": "sse"
    }
  }
}
```

## Dependency Injection

```csharp
services.AddMcpUse(options =>
{
    options.ConfigPath = "~/.config/claude/claude_desktop_config.json";
    options.Security = new SecurityOptions
    {
        EntraId = new EntraIdOptions
        {
            TenantId = configuration["AzureAd:TenantId"]!,
            ClientId = configuration["AzureAd:ClientId"]!
        }
    };
});
```

## Project Structure

```
McpUse/
├── Client/           # Client and session management
├── Agent/            # Agent framework with prompts
├── Managers/         # ServerManager for dynamic server selection
├── Remote/           # RemoteAgent for cloud execution
├── CodeMode/         # Code execution sandbox
├── Adapters/         # LLM provider adapters
├── Middleware/       # Request/response middleware
├── Server/           # Server framework
├── Streaming/        # Stream events
├── Telemetry/        # Observability and telemetry
├── Security/         # Authentication and authorization
├── Connectors/       # Transport connectors (WebSocket, etc.)
├── Configuration/    # Config loading
└── Extensions/       # DI extensions
```

## Feature Parity Matrix

| Feature | Python | TypeScript | C# |
|---------|--------|------------|-----|
| McpClient (multi-server) | ✅ | ✅ | ✅ |
| McpAgent (run/stream) | ✅ | ✅ | ✅ |
| ServerManager | ✅ | ✅ | ✅ |
| RemoteAgent | ✅ | ✅ | ✅ |
| CodeMode | ✅ | ✅ | ✅ |
| StreamEvents | ✅ | ✅ | ✅ |
| Middleware | ✅ | ✅ | ✅ |
| Telemetry/Langfuse | ✅ | ✅ | ✅ |
| MCPServer wrapper | ✅ | ✅ | ✅ |
| OpenAI Adapter | ✅ | ✅ | ✅ |
| Anthropic Adapter | ✅ | ✅ | ✅ |
| Google Adapter | ✅ | ✅ | ✅ |
| WebSocket transport | ✅ | ✅ | ✅ |
| Claude Desktop config | ✅ | ✅ | ✅ |
| Entra ID auth | ❌ | ❌ | ✅ |
| Key Vault secrets | ❌ | ❌ | ✅ |

## Requirements

- .NET 8.0 or later
- For Entra ID auth: Azure subscription with Entra ID configured
- For Key Vault: Azure Key Vault instance

## Security

This library implements [Microsoft's security guidelines for MCP servers](https://aka.ms/mcpsec):

- ✅ Token validation with proper audience verification
- ✅ No token passthrough to downstream services
- ✅ Secure secrets management via Key Vault
- ✅ Security event logging for audit trails
- ✅ Proper HTTP status codes (401/403/400/429)
- ✅ Rate limiting to prevent abuse

## License

MIT

## Contributing

Contributions are welcome! Please see the [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.
