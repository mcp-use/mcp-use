# TypeScript Examples

## Agent Examples

### Basic

| Example | Description |
|---------|-------------|
| [chat_example.ts](agent/basic/chat_example.ts) | Chat agent with built-in conversation memory |
| [mcp_everything.ts](agent/basic/mcp_everything.ts) | Test all MCP functionalities |
| [simplified_agent_example.ts](agent/basic/simplified_agent_example.ts) | Simplified MCPAgent API |

### Advanced

| Example | Description |
|---------|-------------|
| [observability.ts](agent/advanced/observability.ts) | Observability with LangChain and Langfuse |
| [stream_example.ts](agent/advanced/stream_example.ts) | Streaming intermediate steps in real-time |
| [structured_output.ts](agent/advanced/structured_output.ts) | Structured output with schema-aware retries |

### Code Mode

| Example | Description |
|---------|-------------|
| [code_mode_example.ts](agent/code-mode/code_mode_example.ts) | Using MCP tools via code execution |
| [code_mode_e2b_example.ts](agent/code-mode/code_mode_e2b_example.ts) | Code mode with E2B remote sandbox |

### Frameworks

| Example | Description |
|---------|-------------|
| [ai_sdk_example.ts](agent/frameworks/ai_sdk_example.ts) | Vercel AI SDK v5 integration |

### Integrations

| Example | Description |
|---------|-------------|
| [airbnb_use.ts](agent/integrations/airbnb_use.ts) | Airbnb MCP server |
| [blender_use.ts](agent/integrations/blender_use.ts) | Blender MCP server via WebSocket |
| [browser_use.ts](agent/integrations/browser_use.ts) | Browser automation MCP server |
| [filesystem_use.ts](agent/integrations/filesystem_use.ts) | Filesystem operations MCP server |

### Server Management

| Example | Description |
|---------|-------------|
| [add_server_tool.ts](agent/server-management/add_server_tool.ts) | Dynamically add servers during a run |
| [multi_server_example.ts](agent/server-management/multi_server_example.ts) | Working with multiple MCP servers |

## Server Examples

### Basic

| Example | Description |
|---------|-------------|
| [simple/src/server.ts](server/basic/simple/src/server.ts) | Simple MCP server |

### Features

| Example | Description |
|---------|-------------|
| [everything/index.ts](server/features/everything/index.ts) | All MCP features (tools, resources, prompts) |
| [elicitation/src/server.ts](server/features/elicitation/src/server.ts) | Elicitation capabilities (form and URL modes) |
| [sampling/src/server.ts](server/features/sampling/src/server.ts) | Sampling capabilities |
| [notifications/src/server.ts](server/features/notifications/src/server.ts) | Bidirectional notifications |
| [streaming-props/index.ts](server/features/streaming-props/index.ts) | Streaming tool props to widgets |
| [completion/src/server.ts](server/features/completion/src/server.ts) | Completion for prompt and resource arguments |
| [conformance/src/server.ts](server/features/conformance/src/server.ts) | MCP conformance test server |
| [dns-rebinding/src/server.ts](server/features/dns-rebinding/src/server.ts) | DNS rebinding protection |
| [express-middleware/index.ts](server/features/express-middleware/index.ts) | Express and Hono middleware integration |
| [proxy/src/server.ts](server/features/proxy/src/server.ts) | Proxy server setup |
| [client-info/src/server.ts](server/features/client-info/src/server.ts) | Client info and capability access |

### OAuth

| Example | Description |
|---------|-------------|
| [auth0/src/server.ts](server/oauth/auth0/src/server.ts) | Auth0 OAuth integration |
| [supabase/src/server.ts](server/oauth/supabase/src/server.ts) | Supabase OAuth integration |
| [workos/src/server.ts](server/oauth/workos/src/server.ts) | WorkOS AuthKit OAuth integration |

### Deployment

| Example | Description |
|---------|-------------|
| [supabase/functions/mcp-server/index.ts](server/deployment/supabase/functions/mcp-server/index.ts) | Supabase Edge Functions deployment |

### UI

| Example | Description |
|---------|-------------|
| [mcp-ui/index.ts](server/ui/mcp-ui/index.ts) | All UIResource types |
| [mcp-apps/apps-sdk/index.ts](server/ui/mcp-apps/apps-sdk/index.ts) | Automatic UI widget registration |

## Client Examples

### Browser

| Example | Description |
|---------|-------------|
| [full-features-example.ts](client/browser/full-features-example.ts) | Tool calls, sampling, elicitation, notifications |
| [react/](client/browser/react/) | React client integration |
| [commonjs/commonjs_example.cjs](client/browser/commonjs/commonjs_example.cjs) | CommonJS usage |

### Node

| Example | Description |
|---------|-------------|
| [full-features-example.ts](client/node/full-features-example.ts) | Tool calls, sampling, elicitation, notifications |
| [notification-client.ts](client/node/communication/notification-client.ts) | Bidirectional notifications |
| [sampling-client.ts](client/node/communication/sampling-client.ts) | Sampling callback |
| [completion-client.ts](client/node/communication/completion-client.ts) | Autocomplete for prompt arguments |
