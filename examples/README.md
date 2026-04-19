# Examples

This directory contains examples for both Python and TypeScript implementations of mcp-use.

## Templates — ready-to-deploy example apps

If you're looking for **full example apps** you can deploy in one click (Chart Builder, Diagram Builder, Slide Deck, Maps Explorer, Widget Gallery, and more), see the dedicated **[Templates gallery](https://github.com/mcp-use/mcp-use#templates)** in the main README — or browse the [Templates page in the docs](https://mcp-use.com/docs/home/templates). Each template lives in its own repo with a live demo URL and a one-click deploy button.

The examples below are **in-repo code samples** meant to illustrate specific APIs and patterns — not deployable apps.

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
- **[OAuth Dynamic Client Registration](../libraries/python/examples/client/oauth_dynamic_client_registration.py)** - RFC 7591 dynamic client registration
- **[OAuth Preregistered Client](../libraries/python/examples/client/oauth_preregistered.py)** - Using a preregistered OAuth client
- **[Client Middleware Example](../libraries/python/examples/example_middleware.py)** - Client-side middleware pipeline
- **[Sandbox Everything](../libraries/python/examples/sandbox_everything.py)** - E2B sandbox all MCP features
- **[Server Manager](../libraries/python/examples/simple_server_manager_use.py)** - Dynamic multi-server management

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
- **[Node HTTP Client](../libraries/typescript/packages/mcp-use/examples/client/node/full-features-example.ts)** - Node/HTTP client with tool calls, sampling, elicitation, notifications
- **[CommonJS Example](../libraries/typescript/packages/mcp-use/examples/client/browser/commonjs/commonjs_example.cjs)** - CommonJS usage
- **[CLI Examples](../libraries/typescript/packages/mcp-use/examples/client/cli/)** - Command-line interface examples
- **[React Integration](../libraries/typescript/packages/mcp-use/examples/client/browser/react/)** - React client examples
- **[Notifications Client](../libraries/typescript/packages/mcp-use/examples/client/node/communication/notification-client.ts)** - Notification handling
- **[Sampling Client](../libraries/typescript/packages/mcp-use/examples/client/node/communication/sampling-client.ts)** - Sampling configuration

### Server Examples
- **[Basic Server](../libraries/typescript/packages/mcp-use/examples/server/basic/simple/)** - Simple server implementation
- **[Server Features](../libraries/typescript/packages/mcp-use/examples/server/features/)** - Advanced features
  - [Everything](../libraries/typescript/packages/mcp-use/examples/server/features/everything/) - All MCP primitives in one server
  - [Conformance](../libraries/typescript/packages/mcp-use/examples/server/features/conformance/) - MCP conformance test server
  - [Elicitation](../libraries/typescript/packages/mcp-use/examples/server/features/elicitation/) - Form and URL elicitation
  - [Sampling](../libraries/typescript/packages/mcp-use/examples/server/features/sampling/) - Server-initiated LLM sampling
  - [Notifications](../libraries/typescript/packages/mcp-use/examples/server/features/notifications/) - Bidirectional notifications
  - [Completion](../libraries/typescript/packages/mcp-use/examples/server/features/completion/) - Autocomplete for prompt args
  - [Streaming Props](../libraries/typescript/packages/mcp-use/examples/server/features/streaming-props/) - Stream tool props to widgets
  - [Middleware](../libraries/typescript/packages/mcp-use/examples/server/features/middleware/) - Built-in middleware pipeline
  - [Express Middleware](../libraries/typescript/packages/mcp-use/examples/server/features/express-middleware/) - Express/Hono integration
  - [Session Management](../libraries/typescript/packages/mcp-use/examples/server/features/session-management/) - Memory, filesystem, Redis storage
  - [Proxy](../libraries/typescript/packages/mcp-use/examples/server/features/proxy/) - Proxy MCP server
  - [Client Info](../libraries/typescript/packages/mcp-use/examples/server/features/client-info/) - Access client capabilities
  - [DNS Rebinding](../libraries/typescript/packages/mcp-use/examples/server/features/dns-rebinding/) - DNS rebinding protection
- **[OAuth Examples](../libraries/typescript/packages/mcp-use/examples/server/oauth/)** - OAuth implementations
  - [Auth0](../libraries/typescript/packages/mcp-use/examples/server/oauth/auth0/)
  - [Better Auth](../libraries/typescript/packages/mcp-use/examples/server/oauth/better-auth/)
  - [Supabase](../libraries/typescript/packages/mcp-use/examples/server/oauth/supabase/)
  - [WorkOS](../libraries/typescript/packages/mcp-use/examples/server/oauth/workos/)
- **[Deployment](../libraries/typescript/packages/mcp-use/examples/server/deployment/)** - Deployment examples
- **[UI Examples](../libraries/typescript/packages/mcp-use/examples/server/ui/)** — MCP Apps widgets
  - **[MCP Apps (recommended)](../libraries/typescript/packages/mcp-use/examples/server/ui/mcp-apps/)** - Dual-protocol widgets with React auto-discovery
  - [MCP Apps Gallery](../libraries/typescript/packages/mcp-use/examples/server/ui/mcp-ui/) - Three programmatic widgets via `server.uiResource({ type: "mcpApps" })`
  - [Files](../libraries/typescript/packages/mcp-use/examples/server/ui/files/) - File-manager widget using `useFiles`
  - [Model Context](../libraries/typescript/packages/mcp-use/examples/server/ui/model-context/) - Widgets reading host context (theme, locale, safe area)
  - [Apps SDK (legacy)](../libraries/typescript/packages/mcp-use/examples/server/ui/mcp-apps/apps-sdk/) - ChatGPT Apps SDK only — prefer the dual-protocol **MCP Apps** example above

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
