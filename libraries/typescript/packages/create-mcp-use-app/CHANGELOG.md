# create-mcp-use-app

## 0.4.3

### Patch Changes

- 4852465: ## Inspector Package

  ### Major Refactoring and Improvements
  - **Server Architecture**: Refactored server code with major improvements to routing and middleware
    - Removed legacy `mcp-inspector.ts` file in favor of modular architecture
    - Added new `cli.ts` for improved command-line interface handling
    - Added `utils.ts` and `shared-utils-browser.ts` for better code organization
    - Enhanced `shared-routes.ts` with improved route handling and error management
    - Streamlined middleware for better performance

  ### Apps SDK Support
  - Enhanced widget data handling and state management
  - Added `readResource` method in MCPInspector for fetching resources based on server ID
  - Integrated widget data storage and retrieval in inspector routes
  - Enhanced OpenAI component renderer to utilize serverId and readResource for improved functionality
  - Added error handling for widget data storage with detailed logging
  - Improved safe data serialization for widget state management

  ### UI/UX Improvements
  - Enhanced `ConnectionSettingsForm` with copy configuration feature and improved paste functionality for auto-populating form fields with JSON configuration
  - Updated `OpenAIComponentRenderer` to dynamically adjust iframe height based on content
  - Improved resource display with duration metrics and enhanced badge styling
  - Added proper error handling and type safety across components
  - Enhanced `LayoutHeader` with dynamic badge styling for better visual feedback
  - Fixed scrollable tool parameters for better user experience
  - Added mobile-responsive hiding features

  ### Component Enhancements
  - Updated `ResourceResultDisplay` to support OpenAI components with proper metadata handling
  - Enhanced `MessageList` and `ToolResultRenderer` with serverId and readResource props
  - Improved `ToolExecutionPanel` layout with better spacing and styling consistency
  - Replaced static error messages with reusable `NotFound` component
  - Added tooltip support for better user guidance

  ### Bug Fixes
  - Fixed inspector mounting logic by simplifying server URL handling
  - Fixed linting issues across multiple components
  - Fixed server configuration for improved stability

  ## MCP-Use Package

  ### Authentication and Connection
  - **Enhanced OAuth Handling**: Extracted base URL (origin) for OAuth discovery in `onMcpAuthorization` and `useMcp` functions to ensure proper metadata retrieval
  - **Improved Connection Robustness**: Enhanced connection handling by resetting the connecting flag for all terminal states, including `auth_redirect`, to allow for reconnections after authentication
  - Improved logging for connection attempts with better debugging information

  ### Apps SDK Support
  - Enhanced Apps SDK integration for better compatibility
  - Fixed inspector route for improved routing consistency
  - Updated server configuration for better Apps SDK support

  ## Create-MCP-Use-App Package

  ### Version Management
  - **Enhanced Package Version Handling**: Added support for canary mode alongside development and production modes
  - **Flexible Version Resolution**: Updated `getCurrentPackageVersions` to dynamically handle workspace dependencies in development mode and 'latest' versions in production
  - **Canary Mode Support**: Added command options to allow users to specify canary versions for testing environments

  ### Template Processing
  - Improved template processing to dynamically replace version placeholders based on the current mode
  - Enhanced `processTemplateFile` and `copyTemplate` functions to support canary mode
  - Better error handling in template processing workflow

  ### Bug Fixes
  - Fixed mcp-use package version dependencies
  - Simplified workspace root detection for improved clarity
  - Updated version placeholders for better flexibility in production environments

## 0.4.3-canary.1

### Patch Changes

- d305be6: fix mcp use deps

## 0.4.3-canary.0

### Patch Changes

- 119afb7: fix mcp-use packages versions

## 0.4.2

### Patch Changes

- abb7f52: ## Enhanced MCP Inspector with Auto-Connection and Multi-Server Support

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

## 0.4.2-canary.0

### Patch Changes

- d52c050: ## Enhanced MCP Inspector with Auto-Connection and Multi-Server Support

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

## 0.4.1

### Patch Changes

- 3670ed0: minor fixes
- 3670ed0: minor

## 0.4.1-canary.1

### Patch Changes

- a571b5c: minor

## 0.4.1-canary.0

### Patch Changes

- 4ad9c7f: minor fixes

## 0.4.0

### Minor Changes

- 0f2b7f6: feat: Add Apps SDK template for OpenAI platform integration
  - Added new Apps SDK template for creating OpenAI Apps SDK-compatible MCP servers
  - Included example server implementation with Kanban board widget
  - Pre-configured Apps SDK metadata (widgetDescription, widgetPrefersBorder, widgetAccessible, widgetCSP)
  - Example widgets demonstrating structured data handling and UI rendering
  - Comprehensive README with setup instructions and best practices
  - Support for CSP (Content Security Policy) configuration with connect_domains and resource_domains
  - Tool invocation state management examples

## 0.3.5

### Patch Changes

- fix: update to monorepo

## 0.3.4

### Patch Changes

- 55dfebf: Add MCP-UI Resource Integration

  Add uiResource() method to McpServer for unified widget registration with MCP-UI compatibility.
  - Support three resource types: externalUrl (iframe), rawHtml (direct), remoteDom (scripted)
  - Automatic tool and resource generation with ui\_ prefix and ui://widget/ URIs
  - Props-to-parameters conversion with type safety
  - New uiresource template with examples
  - Inspector integration for UI resource rendering
  - Add @mcp-ui/server dependency
  - Complete test coverage

## 0.3.3

### Patch Changes

- fix: export server from mcp-use/server due to edge runtime

## 0.3.2

### Patch Changes

- 1310533: add MCP server feature to mcp-use + add mcp-use inspector + add mcp-use cli build and deployment tool + add create-mcp-use-app for scaffolding mcp-use apps

## 0.3.1

### Patch Changes

- 04b9f14: Update versions

## 0.3.0

### Minor Changes

- Update dependecies versions

## 0.2.1

### Patch Changes

- db54528: Migrated build system from tsc to tsup for faster builds (10-100x improvement) with dual CJS/ESM output support. This is an internal change that improves build performance without affecting the public API.
