---
"@mcp-use/inspector": minor
"mcp-use": patch
"@mcp-use/cli": patch
---

### Inspector Enhancements

- **New**: Custom properties support for resources - `PropsSelect` component for dynamic prop configuration
- **New**: `PropsConfigDialog` for managing resource properties with AI-powered suggestions
- **New**: `SchemaFormField` for rendering JSON schema-based forms
- **New**: `usePropsLLM` hook for AI-powered property suggestions
- **New**: `useResourceProps` hook for managing resource props state
- **Enhancement**: Enhanced `JSONDisplay` with improved line wrapping and font size for better readability
- **Enhancement**: Collapsible description section in `ToolExecutionPanel`
- **Enhancement**: Integrated JSON metadata visualization in tool execution panel
- **Enhancement**: Enhanced `McpUIRenderer` and `OpenAIComponentRenderer` with `customProps` support
- **Enhancement**: Updated `ResourceResultDisplay` with dynamic property configuration

### CLI Improvements

- **New**: `MCP_URL` environment variable for server URL configuration

### MCP Proxy

- **Enhancement**: Improved error logging with better context
- **Enhancement**: Connection refused errors now logged as warnings
- **Enhancement**: Error responses now include target URL for easier debugging
