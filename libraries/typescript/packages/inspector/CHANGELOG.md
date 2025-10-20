# @mcp-use/inspector

## 0.5.0

### Minor Changes

- f513338: Inspector and client updates to improve Apps SDK support and connection robustness.

  ### Inspector (Web UI)
  - Add initial OpenAI Apps SDK component rendering in tool results via `openai/outputTemplate` metadata.
    - Fetch and render widget HTML inside a sandboxed iframe with dynamic height measurement.
    - Provide toggle between Component and Raw JSON views.
    - Persist widget data server-side and serve via new widget endpoints.
  - Enhance Tools tab UX:
    - Saved Requests: save, load, and delete tool requests (stored in `localStorage`).
    - Keyboard navigation for tools and saved requests; improved search focus/expand behavior.
    - Response header shows timestamp and execution duration; quick copy button.
    - Better preview for MCP UI resources alongside JSON.
  - Introduce `useSavedRequests` hook for reading updates to saved requests across tabs/windows.

  ### mcp-use (React)
  - `useMcp` hook: add HTTP transport with automatic fallback to SSE (`transportType: 'auto' | 'http' | 'sse'`).
  - Improve authentication flow with `BrowserOAuthClientProvider`, manual authenticate, and clearer error states.
  - Add auto-retry and auto-reconnect behavior with configurable delays; richer structured logging.
  - More robust resource/prompt/tool requests using SDK schemas and safer error handling.

  ### Server (Inspector)
  - Add widget storage and content endpoints used by Apps SDK components in the inspector UI.

### Patch Changes

- Updated dependencies [f513338]
  - mcp-use@2.0.0

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
