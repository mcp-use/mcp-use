---
'@mcp-use/inspector': patch
'mcp-use': patch
'create-mcp-use-app': patch
---

## Inspector Package

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

