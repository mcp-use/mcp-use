# @mcp-use/inspector

## 0.4.0

### Minor Changes

- d950ea3: reafctor: Refactor Inpector to be aligned with mcp-use-ts
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

- Updated dependencies [d950ea3]
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
