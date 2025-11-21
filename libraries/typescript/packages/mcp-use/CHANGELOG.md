# mcp-use

## 1.3.3

### Patch Changes

- e8ec993: - Add emulation of openai api to the inspector
  - Add utility component WidgetFullscreenWrapper: render full screen and pip buttons
  - Add utility component WidgetDebugger: shows an overlay with openai metadata for debugging ChatGPT integration
- e8ec993: hotfix: Wrap all handle request calls in wait function
- e8ec993: Fix async server tool calls
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
  - @mcp-use/cli@2.2.3
  - @mcp-use/inspector@0.5.3

## 1.3.3-canary.8

### Patch Changes

- Updated dependencies [329ce35]
  - @mcp-use/inspector@0.5.3-canary.8
  - @mcp-use/cli@2.2.3-canary.8

## 1.3.3-canary.7

### Patch Changes

- Updated dependencies [1ed0ab8]
  - @mcp-use/inspector@0.5.3-canary.7
  - @mcp-use/cli@2.2.3-canary.7

## 1.3.3-canary.6

### Patch Changes

- Updated dependencies [ba654db]
  - @mcp-use/inspector@0.5.3-canary.6
  - @mcp-use/cli@2.2.3-canary.6

## 1.3.3-canary.5

### Patch Changes

- Updated dependencies [f971dd8]
  - @mcp-use/inspector@0.5.3-canary.5
  - @mcp-use/cli@2.2.3-canary.5

## 1.3.3-canary.4

### Patch Changes

- 68d0d4c: - Add emulation of openai api to the inspector
  - Add utility component WidgetFullscreenWrapper: render full screen and pip buttons
  - Add utility component WidgetDebugger: shows an overlay with openai metadata for debugging ChatGPT integration
- Updated dependencies [68d0d4c]
- Updated dependencies [68d0d4c]
  - @mcp-use/cli@2.2.3-canary.4
  - @mcp-use/inspector@0.5.3-canary.4

## 1.3.3-canary.3

### Patch Changes

- d4dc001: hotfix: Wrap all handle request calls in wait function
  - @mcp-use/cli@2.2.3-canary.3
  - @mcp-use/inspector@0.5.3-canary.3

## 1.3.3-canary.2

### Patch Changes

- 9fc286c: Fix async server tool calls
  - @mcp-use/cli@2.2.3-canary.2
  - @mcp-use/inspector@0.5.3-canary.2

## 1.3.3-canary.1

### Patch Changes

- Updated dependencies [f7995c0]
  - @mcp-use/cli@2.2.3-canary.1
  - @mcp-use/inspector@0.5.3-canary.1

## 1.3.3-canary.0

### Patch Changes

- Updated dependencies [d4c246a]
  - @mcp-use/inspector@0.5.3-canary.0
  - @mcp-use/cli@2.2.3-canary.0

## 1.3.2

### Patch Changes

- 835d367: - Updated the version of @modelcontextprotocol/sdk to 1.22.0 in both inspector and mcp-use package.json files.
- 835d367: chore: update dependencies
- 835d367: Add entities list preview in cli logs
  https://linear.app/mcp-use/issue/MCP-411/server-create-a-mini-inspector-in-the-server-cli
- Updated dependencies [835d367]
- Updated dependencies [835d367]
- Updated dependencies [835d367]
- Updated dependencies [835d367]
- Updated dependencies [835d367]
- Updated dependencies [835d367]
- Updated dependencies [835d367]
  - @mcp-use/cli@2.2.2
  - @mcp-use/inspector@0.5.2

## 1.3.2-canary.5

### Patch Changes

- d9e3ae2: Add entities list preview in cli logs
  https://linear.app/mcp-use/issue/MCP-411/server-create-a-mini-inspector-in-the-server-cli
  - @mcp-use/cli@2.2.2-canary.5
  - @mcp-use/inspector@0.5.2-canary.5

## 1.3.2-canary.4

### Patch Changes

- Updated dependencies [9db6706]
  - @mcp-use/inspector@0.5.2-canary.4
  - @mcp-use/cli@2.2.2-canary.4

## 1.3.2-canary.3

### Patch Changes

- Updated dependencies [6133446]
  - @mcp-use/cli@2.2.2-canary.3
  - @mcp-use/inspector@0.5.2-canary.3

## 1.3.2-canary.2

### Patch Changes

- Updated dependencies [6e3278b]
  - @mcp-use/cli@2.2.2-canary.2
  - @mcp-use/inspector@0.5.2-canary.2

## 1.3.2-canary.1

### Patch Changes

- Updated dependencies [ecfa449]
  - @mcp-use/cli@2.2.2-canary.1
  - @mcp-use/inspector@0.5.2-canary.1

## 1.3.2-canary.0

### Patch Changes

- 2ebe233: - Updated the version of @modelcontextprotocol/sdk to 1.22.0 in both inspector and mcp-use package.json files.
- 2ebe233: chore: update dependencies
- Updated dependencies [2ebe233]
- Updated dependencies [2ebe233]
- Updated dependencies [2ebe233]
  - @mcp-use/cli@2.2.2-canary.0
  - @mcp-use/inspector@0.5.2-canary.0

## 1.3.1

### Patch Changes

- 91fdcee: - Updated the version of @modelcontextprotocol/sdk to 1.22.0 in both inspector and mcp-use package.json files.
- 91fdcee: chore: update dependencies
- Updated dependencies [91fdcee]
- Updated dependencies [91fdcee]
- Updated dependencies [91fdcee]
  - @mcp-use/cli@2.2.1
  - @mcp-use/inspector@0.5.1

## 1.3.1-canary.0

### Patch Changes

- 9ece7fe: - Updated the version of @modelcontextprotocol/sdk to 1.22.0 in both inspector and mcp-use package.json files.
- 9ece7fe: chore: update dependencies
- Updated dependencies [9ece7fe]
- Updated dependencies [9ece7fe]
- Updated dependencies [9ece7fe]
  - @mcp-use/cli@2.2.1-canary.0
  - @mcp-use/inspector@0.5.1-canary.0

## 1.3.0

### Minor Changes

- 26e1162: Migrated mcp-use server from Express to Hono framework to enable edge runtime support (Cloudflare Workers, Deno Deploy, Supabase Edge Functions). Added runtime detection for Deno/Node.js environments, Connect middleware adapter for compatibility, and `getHandler()` method for edge deployment. Updated dependencies: added `hono` and `@hono/node-server`, moved `connect` and `node-mocks-http` to optional dependencies, removed `express` and `cors` from peer dependencies.

  Added Supabase deployment documentation and example templates to create-mcp-use-app for easier edge runtime deployment.

- 26e1162: ### MCPAgent Message Detection Improvements (fix #446)

  Fixed issue where `agent.run()` returned "No output generated" even when valid output was produced, caused by messages not being AIMessage instances after serialization/deserialization across module boundaries. Added robust message detection helpers (`_isAIMessageLike`, `_isHumanMessageLike`, `_isToolMessageLike`) that handle multiple message formats (class instances, plain objects with `type`/`role` properties, objects with `getType()` methods) to support version mismatches and different LangChain message formats. Includes comprehensive test coverage for message detection edge cases.

  ### Server Base URL Fix

  Fixed server base URL handling to ensure proper connection and routing in edge runtime environments, resolving issues with URL construction and path resolution.

  ### Inspector Enhancements

  Improved auto-connection logic with better error handling and retry mechanisms. Enhanced resource display components and OpenAI component renderer for better reliability and user experience. Updated connection context management for more robust multi-server support.

  ### Supabase Deployment Example

  Added complete Supabase deployment example with Deno-compatible server implementation, deployment scripts, and configuration templates to `create-mcp-use-app` for easier edge runtime deployment.

  ### React Hook and CLI Improvements

  Enhanced `useMcp` hook with better error handling and connection state management for browser-based MCP clients. Updated CLI with improved server URL handling and connection management.

### Patch Changes

- Updated dependencies [26e1162]
- Updated dependencies [f25018a]
- Updated dependencies [26e1162]
  - @mcp-use/cli@2.2.0
  - @mcp-use/inspector@0.5.0

## 1.3.0-canary.1

### Minor Changes

- 9d0be46: ### MCPAgent Message Detection Improvements (fix #446)

  Fixed issue where `agent.run()` returned "No output generated" even when valid output was produced, caused by messages not being AIMessage instances after serialization/deserialization across module boundaries. Added robust message detection helpers (`_isAIMessageLike`, `_isHumanMessageLike`, `_isToolMessageLike`) that handle multiple message formats (class instances, plain objects with `type`/`role` properties, objects with `getType()` methods) to support version mismatches and different LangChain message formats. Includes comprehensive test coverage for message detection edge cases.

  ### Server Base URL Fix

  Fixed server base URL handling to ensure proper connection and routing in edge runtime environments, resolving issues with URL construction and path resolution.

  ### Inspector Enhancements

  Improved auto-connection logic with better error handling and retry mechanisms. Enhanced resource display components and OpenAI component renderer for better reliability and user experience. Updated connection context management for more robust multi-server support.

  ### Supabase Deployment Example

  Added complete Supabase deployment example with Deno-compatible server implementation, deployment scripts, and configuration templates to `create-mcp-use-app` for easier edge runtime deployment.

  ### React Hook and CLI Improvements

  Enhanced `useMcp` hook with better error handling and connection state management for browser-based MCP clients. Updated CLI with improved server URL handling and connection management.

### Patch Changes

- Updated dependencies [9d0be46]
  - @mcp-use/inspector@0.5.0-canary.1
  - @mcp-use/cli@2.2.0-canary.1

## 1.3.0-canary.0

### Minor Changes

- 3db425d: Migrated mcp-use server from Express to Hono framework to enable edge runtime support (Cloudflare Workers, Deno Deploy, Supabase Edge Functions). Added runtime detection for Deno/Node.js environments, Connect middleware adapter for compatibility, and `getHandler()` method for edge deployment. Updated dependencies: added `hono` and `@hono/node-server`, moved `connect` and `node-mocks-http` to optional dependencies, removed `express` and `cors` from peer dependencies.

  Added Supabase deployment documentation and example templates to create-mcp-use-app for easier edge runtime deployment.

### Patch Changes

- Updated dependencies [3db425d]
- Updated dependencies [f25018a]
  - @mcp-use/cli@2.2.0-canary.0
  - @mcp-use/inspector@0.5.0-canary.0

## 1.2.4

### Patch Changes

- 9209e99: fix: prevent OOM errors by avoiding re-exports of @langchain/core types
- 9209e99: fix: inspector dependencies
- Updated dependencies [9209e99]
  - @mcp-use/inspector@0.4.13
  - @mcp-use/cli@2.1.25

## 1.2.4-canary.1

### Patch Changes

- 8194ad2: fix: prevent OOM errors by avoiding re-exports of @langchain/core types
  - @mcp-use/cli@2.1.25-canary.1
  - @mcp-use/inspector@0.4.13-canary.1

## 1.2.4-canary.0

### Patch Changes

- 8e2210a: fix: inspector dependencies
- Updated dependencies [8e2210a]
  - @mcp-use/inspector@0.4.13-canary.0
  - @mcp-use/cli@2.1.25-canary.0

## 1.2.3

### Patch Changes

- 410c67c: Winston is dynamically imported and not bundled
- 410c67c: fix: MCPAgent runtime fails with ERR_PACKAGE_PATH_NOT_EXPORTED in Node.js - package.json file didn't include an export path for ./agent, even though the agent code existed in src/agents/. Additionally, the build configuration (tsup.config.ts) wasn't building the agents as a separate entry point.
  - @mcp-use/cli@2.1.24
  - @mcp-use/inspector@0.4.12

## 1.2.3-canary.1

### Patch Changes

- 7d0f904: Winston is dynamically imported and not bundled
  - @mcp-use/cli@2.1.24-canary.1
  - @mcp-use/inspector@0.4.12-canary.1

## 1.2.3-canary.0

### Patch Changes

- d5ed5ba: fix: MCPAgent runtime fails with ERR_PACKAGE_PATH_NOT_EXPORTED in Node.js - package.json file didn't include an export path for ./agent, even though the agent code existed in src/agents/. Additionally, the build configuration (tsup.config.ts) wasn't building the agents as a separate entry point.
  - @mcp-use/cli@2.1.24-canary.0
  - @mcp-use/inspector@0.4.12-canary.0

## 1.2.2

### Patch Changes

- ceed51b: Standardize code formatting with ESLint + Prettier integration
  - Add Prettier for consistent code formatting across the monorepo
  - Integrate Prettier with ESLint via `eslint-config-prettier` to prevent conflicts
  - Configure pre-commit hooks with `lint-staged` to auto-format staged files
  - Add Prettier format checks to CI pipeline
  - Remove `@antfu/eslint-config` in favor of unified root ESLint configuration
  - Enforce semicolons and consistent code style with `.prettierrc.json`
  - Exclude markdown and JSON files from formatting via `.prettierignore`

- ceed51b: Several major updates:
  - `useMCP` now uses `BrowserMCPClient` (previously it relied on the unofficial SDK).
  - Chat functionality works in the Inspector using client-side message handling (LangChain agents run client-side, not in `useMcp` due to browser compatibility limitations).
  - Chat and Inspector tabs share the same connection.
  - The agent in Chat now has memory (previously, it didn't retain context from the ongoing conversation).
  - The client now uses the advertised capability array from the server to determine which functions to call.
    Previously, it would call functions like `list_resource` regardless of whether the server supported them.
  - Added PostHog integration in the docs.
  - Improved error handling throughout the Chat tab and connection process.
  - Fixed Apps SDK widget rendering with proper parameter passing.

- Updated dependencies [ceed51b]
- Updated dependencies [ceed51b]
  - @mcp-use/inspector@0.4.11
  - @mcp-use/cli@2.1.23

## 1.2.2-canary.1

### Patch Changes

- 3f992c3: Standardize code formatting with ESLint + Prettier integration
  - Add Prettier for consistent code formatting across the monorepo
  - Integrate Prettier with ESLint via `eslint-config-prettier` to prevent conflicts
  - Configure pre-commit hooks with `lint-staged` to auto-format staged files
  - Add Prettier format checks to CI pipeline
  - Remove `@antfu/eslint-config` in favor of unified root ESLint configuration
  - Enforce semicolons and consistent code style with `.prettierrc.json`
  - Exclude markdown and JSON files from formatting via `.prettierignore`

- Updated dependencies [3f992c3]
  - @mcp-use/inspector@0.4.11-canary.1
  - @mcp-use/cli@2.1.23-canary.1

## 1.2.2-canary.0

### Patch Changes

- 38d3c3c: Several major updates:
  - `useMCP` now uses `BrowserMCPClient` (previously it relied on the unofficial SDK).
  - Chat functionality works in the Inspector using client-side message handling (LangChain agents run client-side, not in `useMcp` due to browser compatibility limitations).
  - Chat and Inspector tabs share the same connection.
  - The agent in Chat now has memory (previously, it didn't retain context from the ongoing conversation).
  - The client now uses the advertised capability array from the server to determine which functions to call.
    Previously, it would call functions like `list_resource` regardless of whether the server supported them.
  - Added PostHog integration in the docs.
  - Improved error handling throughout the Chat tab and connection process.
  - Fixed Apps SDK widget rendering with proper parameter passing.

- Updated dependencies [38d3c3c]
  - @mcp-use/inspector@0.4.11-canary.0
  - @mcp-use/cli@2.1.23-canary.0

## 1.2.1

### Patch Changes

- Updated dependencies [9e555ef]
  - @mcp-use/inspector@0.4.10
  - @mcp-use/cli@2.1.22

## 1.2.1-canary.0

### Patch Changes

- Updated dependencies [a5a6919]
  - @mcp-use/inspector@0.4.10-canary.0
  - @mcp-use/cli@2.1.22-canary.0

## 1.2.0

### Minor Changes

- 708cc5b: Support Langchain 1.0.0

### Patch Changes

- 708cc5b: fix: mdoel type for langchain 1.0.0
- 708cc5b: chore: set again cli and inspector as dependencies
- 708cc5b: chore: lint
- 708cc5b: Removed useless logs
- 708cc5b: fix: apps sdk metadata setup from widget build
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
  - @mcp-use/inspector@0.4.9
  - @mcp-use/cli@2.1.21

## 1.2.0-canary.6

### Patch Changes

- a8e5b65: fix: apps sdk metadata setup from widget build
- Updated dependencies [a8e5b65]
  - @mcp-use/inspector@0.4.9-canary.7
  - @mcp-use/cli@2.1.21-canary.7

## 1.2.0-canary.5

### Patch Changes

- 940d727: chore: lint
  - @mcp-use/cli@2.1.21-canary.6
  - @mcp-use/inspector@0.4.9-canary.6

## 1.2.0-canary.4

### Patch Changes

- Updated dependencies [b9b739b]
  - @mcp-use/inspector@0.4.9-canary.5
  - @mcp-use/cli@2.1.21-canary.5

## 1.2.0-canary.3

### Patch Changes

- da6e7ed: chore: set again cli and inspector as dependencies
  - @mcp-use/cli@2.1.21-canary.4
  - @mcp-use/inspector@0.4.9-canary.4

## 1.2.0-canary.2

### Patch Changes

- 3f2d2e9: Removed useless logs
  - @mcp-use/cli@2.1.21-canary.3
  - @mcp-use/inspector@0.4.9-canary.3

## 1.2.0-canary.1

### Patch Changes

- 5dd503f: fix: mdoel type for langchain 1.0.0
  - @mcp-use/cli@2.1.21-canary.2
  - @mcp-use/inspector@0.4.9-canary.2

## 1.2.0-canary.0

### Minor Changes

- b24a213: Support Langchain 1.0.0

### Patch Changes

- @mcp-use/cli@2.1.21-canary.0
- @mcp-use/inspector@0.4.9-canary.0

## 1.1.8

### Patch Changes

- 80213e6: ## Widget Integration & Server Enhancements
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

- 80213e6: fix widget metadata to load from the exported component
- Updated dependencies [80213e6]
  - @mcp-use/inspector@0.4.8
  - @mcp-use/cli@2.1.20

## 1.1.8-canary.1

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
  - @mcp-use/inspector@0.4.8-canary.1
  - @mcp-use/cli@2.1.20-canary.1

## 1.1.8-canary.0

### Patch Changes

- 3074165: fix widget metadata to load from the exported component
  - @mcp-use/cli@2.1.20-canary.0
  - @mcp-use/inspector@0.4.8-canary.0

## 1.1.7

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
  - @mcp-use/inspector@0.4.7
  - @mcp-use/cli@2.1.19

## 1.1.7-canary.0

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
  - @mcp-use/inspector@0.4.7-canary.0
  - @mcp-use/cli@2.1.19-canary.0

## 1.1.6

### Patch Changes

- 696b2e1: Fix Server cors issue
- 696b2e1: Test canary
- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
  - @mcp-use/inspector@0.4.6

## 1.1.6-canary.1

### Patch Changes

- 60f20cb: Test canary
  - @mcp-use/inspector@0.4.6-canary.2

## 1.1.6-canary.0

### Patch Changes

- 6960f7f: Fix Server cors issue
  - @mcp-use/inspector@0.4.6-canary.0

## 1.1.5

### Patch Changes

- 6dcee78: Add starter template + remove ui template
- Updated dependencies [6dcee78]
  - @mcp-use/inspector@0.4.5

## 1.1.5-canary.0

### Patch Changes

- Updated dependencies [d397711]
  - @mcp-use/inspector@0.4.5-canary.0

## 1.1.4

### Patch Changes

- Updated dependencies [09d1e45]
- Updated dependencies [09d1e45]
  - @mcp-use/inspector@0.4.4

## 1.1.4-canary.0

### Patch Changes

- Updated dependencies [f11f846]
  - @mcp-use/inspector@0.4.4-canary.0

## 1.1.3

### Patch Changes

### Authentication and Connection

- **Enhanced OAuth Handling**: Extracted base URL (origin) for OAuth discovery in `onMcpAuthorization` and `useMcp` functions to ensure proper metadata retrieval
- **Improved Connection Robustness**: Enhanced connection handling by resetting the connecting flag for all terminal states, including `auth_redirect`, to allow for reconnections after authentication
- Improved logging for connection attempts with better debugging information

- Updated dependencies [4852465]
  - @mcp-use/inspector@0.4.3

## 1.1.3-canary.1

### Patch Changes

- cb60eef: fix inspector route
- Updated dependencies [0203a77]
- Updated dependencies [ebf1814]
  - @mcp-use/inspector@0.4.3-canary.1

## 1.1.3-canary.0

### Patch Changes

- d171bf7: feat/app-sdk
- Updated dependencies [d171bf7]
  - @mcp-use/inspector@0.4.3-canary.0

## 1.1.2

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
  - @mcp-use/inspector@0.4.2

## 1.1.2-canary.0

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
  - @mcp-use/inspector@0.4.2-canary.0

## 1.1.1

### Patch Changes

- 3670ed0: minor fixes
- 3670ed0: minor
- Updated dependencies [3670ed0]
- Updated dependencies [3670ed0]
  - @mcp-use/inspector@0.4.1

## 1.1.1-canary.1

### Patch Changes

- a571b5c: minor
- Updated dependencies [a571b5c]
  - @mcp-use/inspector@0.4.1-canary.1

## 1.1.1-canary.0

### Patch Changes

- 4ad9c7f: minor fixes
- Updated dependencies [4ad9c7f]
  - @mcp-use/inspector@0.4.1-canary.0

## 1.1.0

### Minor Changes

- 0f2b7f6: feat: Add OpenAI Apps SDK integration
  - Added new UI resource type for Apps SDK, allowing integration with OpenAI's platform
  - Enhanced MCP-UI adapter to handle Apps SDK metadata and structured content
  - Updated resource URI format to support `ui://widget/` scheme
  - Enhanced tool definition with Apps SDK-specific metadata
  - Ensure `_meta` field is at top level of resource object for Apps SDK compatibility
  - Added comprehensive test suite for Apps SDK resource creation
  - Updated type definitions to reflect new resource capabilities

  refactor: Improve compatibility
  - Renamed `fn` to `cb` in tool and prompt definitions for consistency.
  - Updated resource definitions to use `readCallback` instead of `fn`.
  - Adjusted related documentation and type definitions to reflect these changes.
  - Enhanced clarity in the MCP server's API by standardizing callback naming conventions.

### Patch Changes

- Updated dependencies [0f2b7f6]
  - @mcp-use/inspector@0.4.0

## 1.0.7

### Patch Changes

- fix: update to monorepo
- Updated dependencies
  - @mcp-use/inspector@0.3.11

## 1.0.6

### Patch Changes

- 36722a4: Introduced structured output in MCPAgent.streamEvents method, with polling status updates on structured output progress
  - @mcp-use/inspector@0.3.10

## 1.0.5

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
  - @mcp-use/inspector@0.3.9

## 1.0.4

### Patch Changes

- fix: support multiple clients per server
- Updated dependencies
  - @mcp-use/inspector@0.3.8

## 1.0.3

### Patch Changes

- fix: export server from mcp-use/server due to edge runtime
- Updated dependencies
  - @mcp-use/inspector@0.3.7

## 1.0.2

### Patch Changes

- 3bd613e: Non blocking structured output process
  - @mcp-use/inspector@0.3.6

## 1.0.1

### Patch Changes

- 1310533: add MCP server feature to mcp-use + add mcp-use inspector + add mcp-use cli build and deployment tool + add create-mcp-use-app for scaffolding mcp-use apps
- Updated dependencies [1310533]
  - @mcp-use/inspector@0.3.3

## 1.0.0

### Patch Changes

- Updated dependencies
  - @mcp-use/inspector@0.3.0

## 0.3.0

### Minor Changes

- db54528: Added useMcpTools React hook for easier tool management

  ````

  ## Step 5: Commit Everything

  ```bash
  git add .
  git commit -m "feat: add useMcpTools React hook"
  git push origin feat/add-use-mcp-tools-hook
  ````

  ## Step 6: Create Pull Request

  Create a PR on GitHub with:

  **Title:** `feat: add useMcpTools React hook`

  **Description:**

  ```markdown
  ## What

  Adds a new `useMcpTools()` React hook for managing MCP tools.

  ## Why

  Simplifies tool management in React applications.

  ## Changes

  - Added `useMcpTools` hook in `packages/mcp-use/src/react/hooks/`
  - Exported from `mcp-use/react`
  - Added tests for the new hook

  ## Changeset

  ✅ Changeset included (minor bump for mcp-use)
  ```

  ## Step 7: Review & Merge

  After review and approval:

  ```bash
  # Merge the PR to main
  ```

  ## Step 8: Release (Maintainer Task)

  On the `main` branch after merge:

  ```bash
  # Switch to main and pull
  git checkout main
  git pull origin main

  # Check what will be versioned
  pnpm version:check
  ```

  **Output:**

  ```
  🦋  info Packages to be bumped at minor:
  🦋  - mcp-use (0.2.0 → 0.3.0)
  🦋
  🦋  info Packages to be bumped at patch:
  🦋  - @mcp-use/cli (2.0.1 → 2.0.2) ← depends on mcp-use
  🦋  - @mcp-use/inspector (0.1.0 → 0.1.1) ← depends on mcp-use
  ```

  ```bash
  # Apply the version changes
  pnpm version
  ```

  **This will:**
  1. Update `mcp-use/package.json` to `0.3.0`
  2. Update dependent packages (`@mcp-use/cli`, `@mcp-use/inspector`) with patch bumps
  3. Generate/update `CHANGELOG.md` in each package:

  ```markdown
  # mcp-use

  ## 0.3.0

  ### Minor Changes

  - abc1234: Added useMcpTools React hook for easier tool management

  ## 0.2.0

  ...
  ```

  4. Delete `.changeset/random-name-here.md`
  5. Update `pnpm-lock.yaml`

  ```bash
  # Review the changes
  git diff

  # Commit the version changes
  git add .
  git commit -m "chore: version packages"
  git push origin main
  ```

  ## Step 9: Publish to npm

  ```bash
  # Build everything
  pnpm build

  # Publish to npm
  pnpm release
  ```

  **This will:**
  1. Build all packages with tsup
  2. Run `changeset publish`
  3. Publish `mcp-use@0.3.0` to npm
  4. Publish `@mcp-use/cli@2.0.2` to npm
  5. Publish `@mcp-use/inspector@0.1.1` to npm
  6. Create git tags for each version

  **Output:**

  ```
  🦋  info npm info mcp-use
  🦋  info npm publish mcp-use@0.3.0
  🦋  success packages published successfully:
  🦋  - mcp-use@0.3.0
  🦋  - @mcp-use/cli@2.0.2
  🦋  - @mcp-use/inspector@0.1.1
  ```

  ```bash
  # Push tags
  git push --follow-tags
  ```

  ## Step 10: Verify Publication

  ```bash
  # Check on npm
  npm view mcp-use version
  # Output: 0.3.0

  npm view @mcp-use/cli version
  # Output: 2.0.2

  # Or visit:
  # https://www.npmjs.com/package/mcp-use
  # https://www.npmjs.com/package/@mcp-use/cli
  # https://www.npmjs.com/package/@mcp-use/inspector
  # https://www.npmjs.com/package/create-mcp-use-app
  ```

  ## 📊 Timeline Summary
  1. **Day 1**: Developer creates feature + changeset, pushes PR
  2. **Day 2-3**: Code review, changes, approval
  3. **Day 3**: PR merged to main
  4. **Day 3**: Maintainer runs `pnpm version` → Version PR created
  5. **Day 3**: Maintainer reviews and merges Version PR
  6. **Day 3**: Automated workflow publishes to npm
  7. **Done!** ✨

  ## 🤖 Automated Workflow (GitHub Actions)

  With the included GitHub Actions workflows:
  1. **Developer** creates PR with changeset
  2. **CI** validates build, tests, lint
  3. **Merge** to main triggers release workflow
  4. **Changesets Action** creates "Version Packages" PR automatically
  5. **Maintainer** reviews and merges Version PR
  6. **Action** automatically publishes to npm
  7. **Done!** No manual commands needed

  ## 🎓 Learning Resources
  - **Quick Reference**: See `CHANGESET_WORKFLOW.md`
  - **Detailed Guide**: See `VERSIONING.md`
  - **Changesets Docs**: https://github.com/changesets/changesets
  - **Semantic Versioning**: https://semver.org/

  ## 💡 Tips
  - **Batch related changes** - Create one changeset for related changes across packages
  - **Clear summaries** - Write what users need to know, not implementation details
  - **Link to PRs** - Reference PR numbers in changeset summaries
  - **Test before release** - Always build and test before publishing
  - **Coordinate major bumps** - Plan breaking changes with the team

  ***

  **Ready to get started?**

  ```bash
  # Make some changes, then:
  pnpm changeset
  ```

### Patch Changes

- db54528: Migrated build system from tsc to tsup for faster builds (10-100x improvement) with dual CJS/ESM output support. This is an internal change that improves build performance without affecting the public API.
- Updated dependencies [db54528]
  - @mcp-use/inspector@0.2.1
