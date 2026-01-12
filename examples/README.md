# Examples

This directory contains examples for both Python and TypeScript implementations of mcp-use.

## Quick Links

- **[Python Examples](../libraries/python/examples/)** - Python client, server, and agent examples
- **[TypeScript Examples](../libraries/typescript/packages/mcp-use/examples/)** - TypeScript/JavaScript examples

## Local Development

When you clone this repository locally, you'll find `python/` and `typescript/` subdirectories here that are symbolic links to the actual example directories. These symlinks make it convenient to access examples from the repository root.

## Python Examples

### Client Examples
- **[HTTP Example](../libraries/python/examples/http_example.py)** - Basic HTTP client usage
- **[Stream Example](../libraries/python/examples/stream_example.py)** - Streaming responses
- **[Code Mode Example](../libraries/python/examples/code_mode_example.py)** - Code mode execution
- **[Direct Tool Call](../libraries/python/examples/direct_tool_call.py)** - Direct tool invocation
- **[Multi-Server Example](../libraries/python/examples/multi_server_example.py)** - Working with multiple servers

### Server Examples
- **[Basic Server](../libraries/python/examples/server/server_example.py)** - Simple server implementation
- **[Middleware Example](../libraries/python/examples/server/middleware_example.py)** - Server middleware
- **[Context Example](../libraries/python/examples/server/context_example.py)** - Server context usage
- **[OAuth Example](../libraries/python/examples/simple_oauth_example.py)** - OAuth authentication

### Agent Examples
- **[Chat Example](../libraries/python/examples/chat_example.py)** - Basic chat agent
- **[MCP Everything](../libraries/python/examples/mcp_everything.py)** - Comprehensive MCP usage
- **[Structured Output](../libraries/python/examples/structured_output.py)** - Structured responses
- **[Limited Memory Chat](../libraries/python/examples/limited_memory_chat.py)** - Memory management
- **[Multimodal Input](../libraries/python/examples/multimodal_input_example.py)** - Multimodal processing

### Integration Examples
- **[OpenAI Integration](../libraries/python/examples/openai_integration_example.py)** - OpenAI API integration
- **[Anthropic Integration](../libraries/python/examples/anthropic_integration_example.py)** - Anthropic API integration
- **[LangChain Integration](../libraries/python/examples/langchain_integration_example.py)** - LangChain integration
- **[Google Integration](../libraries/python/examples/google_integration_example.py)** - Google API integration

### MCP Server Integrations
- **[Airbnb MCP](../libraries/python/examples/airbnb_use.py)** - Airbnb integration
- **[Blender Use](../libraries/python/examples/blender_use.py)** - Blender integration
- **[Browser Use](../libraries/python/examples/browser_use.py)** - Browser automation
- **[Filesystem Use](../libraries/python/examples/filesystem_use.py)** - Filesystem operations

## TypeScript Examples

### Client Examples
- **[Basic HTTP](../libraries/typescript/packages/mcp-use/examples/client/basic/http_example.ts)** - Basic HTTP client
- **[CommonJS Example](../libraries/typescript/packages/mcp-use/examples/client/basic/commonjs_example.cjs)** - CommonJS usage
- **[CLI Examples](../libraries/typescript/packages/mcp-use/examples/client/cli/)** - Command-line interface examples
- **[React Integration](../libraries/typescript/packages/mcp-use/examples/client/react/)** - React client examples
- **[Notifications Client](../libraries/typescript/packages/mcp-use/examples/client/communication/notification-client.ts)** - Notification handling
- **[Sampling Client](../libraries/typescript/packages/mcp-use/examples/client/communication/sampling-client.ts)** - Sampling configuration

### Server Examples
- **[Basic Server](../libraries/typescript/packages/mcp-use/examples/server/basic/simple/)** - Simple server implementation
- **[Server Features](../libraries/typescript/packages/mcp-use/examples/server/features/)** - Advanced features
  - [Conformance](../libraries/typescript/packages/mcp-use/examples/server/features/conformance/)
  - [Elicitation](../libraries/typescript/packages/mcp-use/examples/server/features/elicitation/)
  - [Notifications](../libraries/typescript/packages/mcp-use/examples/server/features/notifications/)
  - [Sampling](../libraries/typescript/packages/mcp-use/examples/server/features/sampling/)
- **[OAuth Examples](../libraries/typescript/packages/mcp-use/examples/server/oauth/)** - OAuth implementations
  - [Auth0](../libraries/typescript/packages/mcp-use/examples/server/oauth/auth0/)
  - [Supabase](../libraries/typescript/packages/mcp-use/examples/server/oauth/supabase/)
  - [WorkOS](../libraries/typescript/packages/mcp-use/examples/server/oauth/workos/)
- **[Deployment](../libraries/typescript/packages/mcp-use/examples/server/deployment/)** - Deployment examples
- **[UI Examples](../libraries/typescript/packages/mcp-use/examples/server/ui/)** - UI components
  - [Apps SDK](../libraries/typescript/packages/mcp-use/examples/server/ui/apps-sdk/)
  - [MCP UI](../libraries/typescript/packages/mcp-use/examples/server/ui/mcp-ui/)

### Agent Examples
- **[Basic Examples](../libraries/typescript/packages/mcp-use/examples/agent/basic/)** - Basic agent patterns
  - [Chat Example](../libraries/typescript/packages/mcp-use/examples/agent/basic/chat_example.ts)
  - [MCP Everything](../libraries/typescript/packages/mcp-use/examples/agent/basic/mcp_everything.ts)
  - [Simplified Agent](../libraries/typescript/packages/mcp-use/examples/agent/basic/simplified_agent_example.ts)
- **[Advanced Examples](../libraries/typescript/packages/mcp-use/examples/agent/advanced/)** - Advanced patterns
  - [Observability](../libraries/typescript/packages/mcp-use/examples/agent/advanced/observability.ts)
  - [Streaming](../libraries/typescript/packages/mcp-use/examples/agent/advanced/stream_example.ts)
  - [Structured Output](../libraries/typescript/packages/mcp-use/examples/agent/advanced/structured_output.ts)
- **[Code Mode](../libraries/typescript/packages/mcp-use/examples/agent/code-mode/)** - Code execution
  - [Basic Code Mode](../libraries/typescript/packages/mcp-use/examples/agent/code-mode/code_mode_example.ts)
  - [E2B Code Mode](../libraries/typescript/packages/mcp-use/examples/agent/code-mode/code_mode_e2b_example.ts)
- **[Frameworks](../libraries/typescript/packages/mcp-use/examples/agent/frameworks/)** - Framework integrations
  - [AI SDK Example](../libraries/typescript/packages/mcp-use/examples/agent/frameworks/ai_sdk_example.ts)
- **[Integrations](../libraries/typescript/packages/mcp-use/examples/agent/integrations/)** - MCP server integrations
  - [Airbnb](../libraries/typescript/packages/mcp-use/examples/agent/integrations/airbnb_use.ts)
  - [Blender](../libraries/typescript/packages/mcp-use/examples/agent/integrations/blender_use.ts)
  - [Browser](../libraries/typescript/packages/mcp-use/examples/agent/integrations/browser_use.ts)
  - [Filesystem](../libraries/typescript/packages/mcp-use/examples/agent/integrations/filesystem_use.ts)
- **[Server Management](../libraries/typescript/packages/mcp-use/examples/agent/server-management/)** - Dynamic server management
  - [Add Server Tool](../libraries/typescript/packages/mcp-use/examples/agent/server-management/add_server_tool.ts)
  - [Multi-Server](../libraries/typescript/packages/mcp-use/examples/agent/server-management/multi_server_example.ts)
