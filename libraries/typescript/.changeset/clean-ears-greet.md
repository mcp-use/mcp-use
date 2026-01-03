---
"@mcp-use/inspector": minor
"mcp-use": minor
"@mcp-use/cli": minor
---

## Multi-Server Support and Architecture Improvements

### Features

- **Multi-server management**: Introduced `McpClientProvider` to manage multiple MCP server connections, allowing dynamic addition and removal of servers in React applications
- **Storage providers**: Added pluggable storage system with `LocalStorageProvider` and `MemoryStorageProvider` for flexible server configuration persistence
- **Enhanced RPC logging**: New `rpc-logger` module with filtering capabilities to reduce noisy endpoint logging (telemetry, RPC streams)
- **Browser support**: Exported `MCPAgent` for browser usage with `BrowserMCPClient` instance or through `RemoteAgent`

### Inspector Enhancements

- **Improved UI responsiveness**: Enhanced mobile and tablet layouts with adaptive component visibility
- **Better server management**: Refactored server connection handling with improved icon display and status tracking
- **Enhanced debugging**: Added detailed logging in Layout and useAutoConnect components for better monitoring of server connection states
- **Simplified connection settings**: Removed deprecated transport types for cleaner configuration

### Architecture Changes

- Removed obsolete `McpContext` (replaced with `McpClientProvider`)
- Refactored `useMcp` hook for better multi-server support
- Updated components across inspector for cleaner architecture and imports
- Added multi-server React example demonstrating new capabilities

### Bug Fixes

- Fixed server connection retrieval in `OpenAIComponentRenderer` to directly access connections array
