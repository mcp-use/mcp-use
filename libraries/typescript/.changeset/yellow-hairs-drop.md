---
'@mcp-use/inspector': minor
---

reafctor: Refactor Inpector to be aligned with mcp-use-ts

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
