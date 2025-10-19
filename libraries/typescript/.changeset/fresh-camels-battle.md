---
'create-mcp-use-app': patch
'@mcp-use/inspector': patch
'mcp-use': patch
'@mcp-use/cli': patch
---

## Enhanced MCP Inspector with Auto-Connection and Multi-Server Support

### 🚀 New Features

- **Auto-connection functionality**: Inspector now automatically connects to MCP servers on startup
- **Multi-server support**: Enhanced support for connecting to multiple MCP servers simultaneously
- **Client-side chat functionality**: New client-side chat implementation with improved message handling
- **Resource handling**: Enhanced chat components with proper resource management
- **Browser integration**: Improved browser-based MCP client with better connection handling

### 🔧 Improvements

- **Streamlined routing**: Refactored server and client routing for better performance
- **Enhanced connection handling**: Improved auto-connection logic and error handling
- **Better UI components**: Updated Layout, ChatTab, and ToolsTab components
- **Dependency updates**: Updated various dependencies for better compatibility

### 🐛 Fixes

- Fixed connection handling in InspectorDashboard
- Improved error messages in useMcp hook
- Enhanced Layout component connection handling

### 📦 Technical Changes

- Added new client-side chat hooks and components
- Implemented shared routing and static file handling
- Enhanced tool result rendering and display
- Added browser-specific utilities and stubs
- Updated Vite configuration for better development experience
