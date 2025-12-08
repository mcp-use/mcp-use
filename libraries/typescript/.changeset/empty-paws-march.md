---
"create-mcp-use-app": minor
"@mcp-use/inspector": minor
"mcp-use": minor
"@mcp-use/cli": minor
---

## Breaking Changes

- **Server API**: Renamed `createMCPServer()` factory function to `MCPServer` class constructor. The factory function is still available for backward compatibility but new code should use `new MCPServer({ name, ... })`.
- **Session API**: Replaced `session.connector.tools`, `session.connector.callTool()`, etc. with direct methods: `session.tools`, `session.callTool()`, `session.listResources()`, `session.readResource()`, etc.
- **OAuth Environment Variables**: Standardized OAuth env vars to `MCP_USE_OAUTH_*` prefix (e.g., `AUTH0_DOMAIN` → `MCP_USE_OAUTH_AUTH0_DOMAIN`).

## New Features

- **Client Capabilities API**: Added `ctx.client.can()` and `ctx.client.capabilities()` to check client capabilities in tool callbacks.
- **Session Notifications**: Added `ctx.sendNotification()` and `ctx.sendNotificationToSession()` for sending notifications from tool callbacks.
- **Session Info**: Added `ctx.session.sessionId` to access current session ID in tool callbacks.
- **Resource Template Flat Structure**: Resource templates now support flat structure with `uriTemplate` directly on definition (in addition to nested structure).
- **Resource Template Callback Signatures**: Resource template callbacks now support multiple signatures: `()`, `(uri)`, `(uri, params)`, `(uri, params, ctx)`.
- **Type Exports**: Added exports for `CallToolResult`, `Tool`, `ToolAnnotations`, `PromptResult`, `GetPromptResult` types.

## Improvements

- **Type Inference**: Enhanced type inference for resource template callbacks with better overload support.
- **Client Capabilities Tracking**: Server now captures and stores client capabilities during initialization.
- **Session Methods**: Added convenience methods to `MCPSession` for all MCP operations (listResources, readResource, subscribeToResource, listPrompts, getPrompt, etc.).
- **Documentation**: Major documentation refactoring and restructuring for better organization.
