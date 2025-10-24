# @mcp-use/inspector

## 0.4.8-canary.1

### Patch Changes

- 370120e: ## Widget Integration & Server Enhancements
  - Enhanced widget integration capabilities in MCP server with improved handling
  - Streamlined widget HTML generation with comprehensive logging
  - Better server reliability and error handling for widget operations

  ## CLI Tunnel Support & Development Workflow
  - Added comprehensive tunnel support to CLI for seamless server exposure
  - Enhanced development workflow with tunnel integration capabilities
  - Disabled tunnel in dev mode for optimal Vite compatibility

  ## Inspector UI & User Experience Improvements
  - Enhanced inspector UI components with better tunnel URL handling
  - Improved user experience with updated dependencies and compatibility
  - Better visual feedback and error handling in inspector interface

  ## Technical Improvements
  - Enhanced logging capabilities throughout the system
  - Improved error handling and user feedback mechanisms
  - Updated dependencies for better stability and performance

- Updated dependencies [370120e]
  - mcp-use@1.1.8-canary.1

## 0.4.8-canary.0

### Patch Changes

- Updated dependencies [3074165]
  - mcp-use@1.1.8-canary.0

## 0.4.7

### Patch Changes

- 3c87c42: ## Apps SDK widgets & Automatic Widget Registration

  ### Key Features Added

  #### Automatic UI Widget Registration
  - **Major Enhancement**: React components in `resources/` folder now auto-register as MCP tools and resources
  - No boilerplate needed, just export `widgetMetadata` with Zod schema
  - Automatically creates both MCP tool and `ui://widget/{name}` resource endpoints
  - Integration with existing manual registration patterns

  #### Template System Restructuring
  - Renamed `ui-resource` → `mcp-ui` for clarity
  - Consolidated `apps-sdk-demo` into streamlined `apps-sdk` template
  - Enhanced `starter` template as default with both MCP-UI and Apps SDK examples
  - Added comprehensive weather examples to all templates

  #### 📚 Documentation Enhancements
  - Complete rewrite of template documentation with feature comparison matrices
  - New "Automatic Widget Registration" section in ui-widgets.mdx
  - Updated quick start guides for all package managers (npm, pnpm, yarn)
  - Added practical weather widget implementation examples

- Updated dependencies [3c87c42]
  - mcp-use@1.1.7

## 0.4.7-canary.0

### Patch Changes

- 6b8fdf2: ## Apps SDK widgets & Automatic Widget Registration

  ### Key Features Added

  #### Automatic UI Widget Registration
  - **Major Enhancement**: React components in `resources/` folder now auto-register as MCP tools and resources
  - No boilerplate needed, just export `widgetMetadata` with Zod schema
  - Automatically creates both MCP tool and `ui://widget/{name}` resource endpoints
  - Integration with existing manual registration patterns

  #### Template System Restructuring
  - Renamed `ui-resource` → `mcp-ui` for clarity
  - Consolidated `apps-sdk-demo` into streamlined `apps-sdk` template
  - Enhanced `starter` template as default with both MCP-UI and Apps SDK examples
  - Added comprehensive weather examples to all templates

  #### 📚 Documentation Enhancements
  - Complete rewrite of template documentation with feature comparison matrices
  - New "Automatic Widget Registration" section in ui-widgets.mdx
  - Updated quick start guides for all package managers (npm, pnpm, yarn)
  - Added practical weather widget implementation examples

- Updated dependencies [6b8fdf2]
  - mcp-use@1.1.7-canary.0

## 0.4.6

### Patch Changes

- 696b2e1: fix ph use ph-node
- 696b2e1: fix scarf
- 696b2e1: The main changes ensure that the proxy does not request or forward compressed responses and that problematic headers are filtered out when forwarding responses.
- 696b2e1: fix logging
- 696b2e1: add ph
- 696b2e1: chore: cleanup logging
- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
  - mcp-use@1.1.6

## 0.4.6-canary.7

### Patch Changes

- 21a46d0: fix logging

## 0.4.6-canary.6

### Patch Changes

- c0d9b0b: chore: cleanup logging

## 0.4.6-canary.5

### Patch Changes

- 1f18132: fix ph use ph-node

## 0.4.6-canary.4

### Patch Changes

- f958d73: The main changes ensure that the proxy does not request or forward compressed responses and that problematic headers are filtered out when forwarding responses.

## 0.4.6-canary.3

### Patch Changes

- 6010d08: fix scarf

## 0.4.6-canary.2

### Patch Changes

- Updated dependencies [60f20cb]
  - mcp-use@1.1.6-canary.1

## 0.4.6-canary.1

### Patch Changes

- 3d759e9: add ph

## 0.4.6-canary.0

### Patch Changes

- Updated dependencies [6960f7f]
  - mcp-use@1.1.6-canary.0

## 0.4.5

### Patch Changes

- 6dcee78: fix inspector chat formatting
- Updated dependencies [6dcee78]
  - mcp-use@1.1.5

## 0.4.5-canary.0

### Patch Changes

- d397711: fix inspector chat formatting
  - mcp-use@1.1.5-canary.0

## 0.4.4

### Patch Changes

- 09d1e45: fix: inspector chat
- 09d1e45: fix inspector shadow
  - mcp-use@1.1.4

## 0.4.4-canary.1

### Patch Changes

- f88801a: fix inspector shadow

## 0.4.4-canary.0

### Patch Changes

- f11f846: fix: inspector chat
  - mcp-use@1.1.4-canary.0

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

## 0.4.3-canary.1

### Patch Changes

- 0203a77: fix lint
- ebf1814: fix server of inspector
- Updated dependencies [cb60eef]
  - mcp-use@1.1.3-canary.1

## 0.4.3-canary.0

### Patch Changes

- d171bf7: feat/app-sdk
- Updated dependencies [d171bf7]
  - mcp-use@1.1.3-canary.0

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

- Updated dependencies [abb7f52]
  - mcp-use@1.1.2

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

- Updated dependencies [d52c050]
  - mcp-use@1.1.2-canary.0

## 0.4.1

### Patch Changes

- 3670ed0: minor fixes
- 3670ed0: minor
- Updated dependencies [3670ed0]
- Updated dependencies [3670ed0]
  - mcp-use@1.1.1

## 0.4.1-canary.1

### Patch Changes

- a571b5c: minor
- Updated dependencies [a571b5c]
  - mcp-use@1.1.1-canary.1

## 0.4.1-canary.0

### Patch Changes

- 4ad9c7f: minor fixes
- Updated dependencies [4ad9c7f]
  - mcp-use@1.1.1-canary.0

## 0.4.0

### Minor Changes

- 0f2b7f6: reafctor: Refactor Inpector to be aligned with mcp-use-ts
  - Migrated from CommonJS to ESM format
  - Added input validation for port and URL
  - Improved error handling and logging
  - Added `open` package for cross-platform browser launching
  - Chat components: `AssistantMessage`, `UserMessage`, `ToolCallDisplay`, `MCPUIResource`, `MessageList`
  - UI components: `aurora-background`, `text-shimmer`, `sheet`, `switch`, `kbd`, `shimmer-button`, `status-dot`
  - Form components: `ConnectionSettingsForm`, `ServerDropdown`
  - Tool components: `ToolExecutionPanel`, `ToolResultDisplay`, `SaveRequestDialog`
  - Resource components: `ResourceResultDisplay`, `ResourcesList`
  - Reorganized component structure (moved to `src/client/components/`)
  - Refactored `ChatTab` to use streaming API and custom hooks
  - Enhanced `InspectorDashboard` with auto-connect functionality
  - Improved `CommandPalette` with better item selection
  - Updated routing to use query parameters
  - Updated `@types/node` to 20.19.21
  - Upgraded `@typescript-eslint` packages to 8.46.1
  - Added `inquirer@9.3.8` and `ora@8.2.0` for better CLI experience
  - Removed `AddServerDialog` and `ServerSelectionModal` to streamline UI
  - Cleaned up obsolete TypeScript declaration files

  fix: CLI binary format and package configuration
  - Changed CLI build format from CommonJS to ESM for ESM-only dependency compatibility
  - Added prepublishOnly hook to ensure build before publishing
  - Updated documentation references from @mcp-use/inspect to @mcp-use/inspector
  - Removed compiled artifacts from source directory
  - Added input validation for port and URL arguments
  - Improved error logging in API routes
  - Fixed async/await bugs in static file serving

### Patch Changes

- Updated dependencies [0f2b7f6]
  - mcp-use@1.1.0

## 0.3.9

### Patch Changes

- Updated dependencies [55dfebf]
  - mcp-use@1.0.5

## 0.3.8

### Patch Changes

- fix: support multiple clients per server
- Updated dependencies
  - mcp-use@1.0.4

## 0.3.7

### Patch Changes

- fix: export server from mcp-use/server due to edge runtime
- Updated dependencies
  - mcp-use@1.0.3

## 0.3.6

### Patch Changes

- Updated dependencies [3bd613e]
  - mcp-use@1.0.2

## 0.3.5

### Patch Changes

- 8e92eaa: Bump version to fix npm publish issue - version 0.3.3 was already published

## 0.3.4

### Patch Changes

- Bump version to fix npm publish issue - version 0.3.3 was already published

## 0.3.3

### Patch Changes

- 1310533: add MCP server feature to mcp-use + add mcp-use inspector + add mcp-use cli build and deployment tool + add create-mcp-use-app for scaffolding mcp-use apps
- Updated dependencies [1310533]
  - mcp-use@1.0.1

## 0.3.2

### Patch Changes

- 6fa0026: Fix cli dist

## 0.3.1

### Patch Changes

- 04b9f14: Update versions

## 0.3.0

### Minor Changes

- Update dependecies versions

### Patch Changes

- mcp-use@1.0.0

## 0.2.1

### Patch Changes

- db54528: Migrated build system from tsc to tsup for faster builds (10-100x improvement) with dual CJS/ESM output support. This is an internal change that improves build performance without affecting the public API.
- Updated dependencies [db54528]
- Updated dependencies [db54528]
  - mcp-use@0.3.0
