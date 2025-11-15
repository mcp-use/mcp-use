# @mcp-use/cli

## 2.2.1

### Patch Changes

- 91fdcee: fix with-inspector param
- 91fdcee: chore: update dependencies
- Updated dependencies [91fdcee]
- Updated dependencies [91fdcee]
  - @mcp-use/inspector@0.5.1
  - mcp-use@1.3.1

## 2.2.1-canary.0

### Patch Changes

- 9ece7fe: fix with-inspector param
- 9ece7fe: chore: update dependencies
- Updated dependencies [9ece7fe]
- Updated dependencies [9ece7fe]
  - @mcp-use/inspector@0.5.1-canary.0
  - mcp-use@1.3.1-canary.0

## 2.2.0

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
  - mcp-use@1.3.0
  - @mcp-use/inspector@0.5.0

## 2.2.0-canary.1

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
  - mcp-use@1.3.0-canary.1

## 2.2.0-canary.0

### Minor Changes

- 3db425d: Migrated mcp-use server from Express to Hono framework to enable edge runtime support (Cloudflare Workers, Deno Deploy, Supabase Edge Functions). Added runtime detection for Deno/Node.js environments, Connect middleware adapter for compatibility, and `getHandler()` method for edge deployment. Updated dependencies: added `hono` and `@hono/node-server`, moved `connect` and `node-mocks-http` to optional dependencies, removed `express` and `cors` from peer dependencies.

  Added Supabase deployment documentation and example templates to create-mcp-use-app for easier edge runtime deployment.

### Patch Changes

- Updated dependencies [3db425d]
- Updated dependencies [f25018a]
  - mcp-use@1.3.0-canary.0
  - @mcp-use/inspector@0.5.0-canary.0

## 2.1.25

### Patch Changes

- Updated dependencies [9209e99]
- Updated dependencies [9209e99]
  - mcp-use@1.2.4
  - @mcp-use/inspector@0.4.13

## 2.1.25-canary.1

### Patch Changes

- Updated dependencies [8194ad2]
  - mcp-use@1.2.4-canary.1
  - @mcp-use/inspector@0.4.13-canary.1

## 2.1.25-canary.0

### Patch Changes

- Updated dependencies [8e2210a]
  - @mcp-use/inspector@0.4.13-canary.0
  - mcp-use@1.2.4-canary.0

## 2.1.24

### Patch Changes

- Updated dependencies [410c67c]
- Updated dependencies [410c67c]
  - mcp-use@1.2.3
  - @mcp-use/inspector@0.4.12

## 2.1.24-canary.1

### Patch Changes

- Updated dependencies [7d0f904]
  - mcp-use@1.2.3-canary.1
  - @mcp-use/inspector@0.4.12-canary.1

## 2.1.24-canary.0

### Patch Changes

- Updated dependencies [d5ed5ba]
  - mcp-use@1.2.3-canary.0
  - @mcp-use/inspector@0.4.12-canary.0

## 2.1.23

### Patch Changes

- ceed51b: Standardize code formatting with ESLint + Prettier integration
  - Add Prettier for consistent code formatting across the monorepo
  - Integrate Prettier with ESLint via `eslint-config-prettier` to prevent conflicts
  - Configure pre-commit hooks with `lint-staged` to auto-format staged files
  - Add Prettier format checks to CI pipeline
  - Remove `@antfu/eslint-config` in favor of unified root ESLint configuration
  - Enforce semicolons and consistent code style with `.prettierrc.json`
  - Exclude markdown and JSON files from formatting via `.prettierignore`

- Updated dependencies [ceed51b]
- Updated dependencies [ceed51b]
  - @mcp-use/inspector@0.4.11
  - mcp-use@1.2.2

## 2.1.23-canary.1

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
  - mcp-use@1.2.2-canary.1

## 2.1.23-canary.0

### Patch Changes

- Updated dependencies [38d3c3c]
  - @mcp-use/inspector@0.4.11-canary.0
  - mcp-use@1.2.2-canary.0

## 2.1.22

### Patch Changes

- Updated dependencies [9e555ef]
  - @mcp-use/inspector@0.4.10
  - mcp-use@1.2.1

## 2.1.22-canary.0

### Patch Changes

- Updated dependencies [a5a6919]
  - @mcp-use/inspector@0.4.10-canary.0
  - mcp-use@1.2.1-canary.0

## 2.1.21

### Patch Changes

- 708cc5b: fix: apps sdk metadata setup from widget build
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
  - mcp-use@1.2.0
  - @mcp-use/inspector@0.4.9

## 2.1.21-canary.7

### Patch Changes

- a8e5b65: fix: apps sdk metadata setup from widget build
- Updated dependencies [a8e5b65]
  - @mcp-use/inspector@0.4.9-canary.7
  - mcp-use@1.2.0-canary.6

## 2.1.21-canary.6

### Patch Changes

- Updated dependencies [940d727]
  - mcp-use@1.2.0-canary.5
  - @mcp-use/inspector@0.4.9-canary.6

## 2.1.21-canary.5

### Patch Changes

- Updated dependencies [b9b739b]
  - @mcp-use/inspector@0.4.9-canary.5
  - mcp-use@1.2.0-canary.4

## 2.1.21-canary.4

### Patch Changes

- Updated dependencies [da6e7ed]
  - mcp-use@1.2.0-canary.3
  - @mcp-use/inspector@0.4.9-canary.4

## 2.1.21-canary.3

### Patch Changes

- Updated dependencies [3f2d2e9]
  - mcp-use@1.2.0-canary.2
  - @mcp-use/inspector@0.4.9-canary.3

## 2.1.21-canary.2

### Patch Changes

- Updated dependencies [5dd503f]
  - mcp-use@1.2.0-canary.1
  - @mcp-use/inspector@0.4.9-canary.2

## 2.1.21-canary.1

### Patch Changes

- Updated dependencies [3b72cde]
  - @mcp-use/inspector@0.4.9-canary.1

## 2.1.21-canary.0

### Patch Changes

- Updated dependencies [b24a213]
  - mcp-use@1.2.0-canary.0
  - @mcp-use/inspector@0.4.9-canary.0

## 2.1.20

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

- Updated dependencies [80213e6]
- Updated dependencies [80213e6]
  - @mcp-use/inspector@0.4.8
  - mcp-use@1.1.8

## 2.1.20-canary.1

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
  - mcp-use@1.1.8-canary.1

## 2.1.20-canary.0

### Patch Changes

- Updated dependencies [3074165]
  - mcp-use@1.1.8-canary.0
  - @mcp-use/inspector@0.4.8-canary.0

## 2.1.19

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
  - mcp-use@1.1.7

## 2.1.19-canary.0

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
  - mcp-use@1.1.7-canary.0

## 2.1.18

### Patch Changes

- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
- Updated dependencies [696b2e1]
  - @mcp-use/inspector@0.4.6
  - mcp-use@1.1.6

## 2.1.18-canary.7

### Patch Changes

- Updated dependencies [21a46d0]
  - @mcp-use/inspector@0.4.6-canary.7

## 2.1.18-canary.6

### Patch Changes

- Updated dependencies [c0d9b0b]
  - @mcp-use/inspector@0.4.6-canary.6

## 2.1.18-canary.5

### Patch Changes

- Updated dependencies [1f18132]
  - @mcp-use/inspector@0.4.6-canary.5

## 2.1.18-canary.4

### Patch Changes

- Updated dependencies [f958d73]
  - @mcp-use/inspector@0.4.6-canary.4

## 2.1.18-canary.3

### Patch Changes

- Updated dependencies [6010d08]
  - @mcp-use/inspector@0.4.6-canary.3

## 2.1.18-canary.2

### Patch Changes

- Updated dependencies [60f20cb]
  - mcp-use@1.1.6-canary.1
  - @mcp-use/inspector@0.4.6-canary.2

## 2.1.18-canary.1

### Patch Changes

- Updated dependencies [3d759e9]
  - @mcp-use/inspector@0.4.6-canary.1

## 2.1.18-canary.0

### Patch Changes

- Updated dependencies [6960f7f]
  - mcp-use@1.1.6-canary.0
  - @mcp-use/inspector@0.4.6-canary.0

## 2.1.17

### Patch Changes

- 6dcee78: fix inspector chat formatting
- Updated dependencies [6dcee78]
- Updated dependencies [6dcee78]
  - @mcp-use/inspector@0.4.5
  - mcp-use@1.1.5

## 2.1.17-canary.0

### Patch Changes

- Updated dependencies [d397711]
  - @mcp-use/inspector@0.4.5-canary.0
  - mcp-use@1.1.5-canary.0

## 2.1.16

### Patch Changes

- Updated dependencies [09d1e45]
- Updated dependencies [09d1e45]
  - @mcp-use/inspector@0.4.4
  - mcp-use@1.1.4

## 2.1.16-canary.1

### Patch Changes

- Updated dependencies [f88801a]
  - @mcp-use/inspector@0.4.4-canary.1

## 2.1.16-canary.0

### Patch Changes

- Updated dependencies [f11f846]
  - @mcp-use/inspector@0.4.4-canary.0
  - mcp-use@1.1.4-canary.0

## 2.1.15

### Patch Changes

- Updated dependencies [4852465]
  - @mcp-use/inspector@0.4.3
  - mcp-use@1.1.3

## 2.1.15-canary.1

### Patch Changes

- Updated dependencies [0203a77]
- Updated dependencies [ebf1814]
- Updated dependencies [cb60eef]
  - @mcp-use/inspector@0.4.3-canary.1
  - mcp-use@1.1.3-canary.1

## 2.1.15-canary.0

### Patch Changes

- Updated dependencies [d171bf7]
  - @mcp-use/inspector@0.4.3-canary.0
  - mcp-use@1.1.3-canary.0

## 2.1.14

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
  - mcp-use@1.1.2

## 2.1.14-canary.0

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
  - mcp-use@1.1.2-canary.0

## 2.1.13

### Patch Changes

- 3670ed0: minor fixes
- 3670ed0: minor
- Updated dependencies [3670ed0]
- Updated dependencies [3670ed0]
  - @mcp-use/inspector@0.4.1
  - mcp-use@1.1.1

## 2.1.13-canary.1

### Patch Changes

- a571b5c: minor
- Updated dependencies [a571b5c]
  - @mcp-use/inspector@0.4.1-canary.1
  - mcp-use@1.1.1-canary.1

## 2.1.13-canary.0

### Patch Changes

- 4ad9c7f: minor fixes
- Updated dependencies [4ad9c7f]
  - @mcp-use/inspector@0.4.1-canary.0
  - mcp-use@1.1.1-canary.0

## 2.1.12

### Patch Changes

- Updated dependencies [0f2b7f6]
- Updated dependencies [0f2b7f6]
  - mcp-use@1.1.0
  - @mcp-use/inspector@0.4.0

## 2.1.11

### Patch Changes

- fix: update to monorepo
- Updated dependencies
  - @mcp-use/inspector@0.3.11
  - mcp-use@1.0.7

## 2.1.10

### Patch Changes

- Updated dependencies [36722a4]
  - mcp-use@1.0.6
  - @mcp-use/inspector@0.3.10

## 2.1.9

### Patch Changes

- Updated dependencies [55dfebf]
  - mcp-use@1.0.5
  - @mcp-use/inspector@0.3.9

## 2.1.8

### Patch Changes

- Updated dependencies
  - @mcp-use/inspector@0.3.8
  - mcp-use@1.0.4

## 2.1.7

### Patch Changes

- Updated dependencies
  - @mcp-use/inspector@0.3.7
  - mcp-use@1.0.3

## 2.1.6

### Patch Changes

- Updated dependencies [3bd613e]
  - mcp-use@1.0.2
  - @mcp-use/inspector@0.3.6

## 2.1.5

### Patch Changes

- 8e92eaa: Bump version to fix npm publish issue - version 2.1.3 was already published
- Updated dependencies [8e92eaa]
  - @mcp-use/inspector@0.3.5

## 2.1.4

### Patch Changes

- Bump version to fix npm publish issue - version 2.1.3 was already published
- Updated dependencies
  - @mcp-use/inspector@0.3.4

## 2.1.3

### Patch Changes

- 1310533: add MCP server feature to mcp-use + add mcp-use inspector + add mcp-use cli build and deployment tool + add create-mcp-use-app for scaffolding mcp-use apps
- Updated dependencies [1310533]
  - @mcp-use/inspector@0.3.3
  - mcp-use@1.0.1

## 2.1.2

### Patch Changes

- 6fa0026: Fix cli dist
- Updated dependencies [6fa0026]
  - @mcp-use/inspector@0.3.2

## 2.1.1

### Patch Changes

- 04b9f14: Update versions
- Updated dependencies [04b9f14]
  - @mcp-use/inspector@0.3.1

## 2.1.0

### Minor Changes

- Update dependecies versions

### Patch Changes

- Updated dependencies
  - @mcp-use/inspector@0.3.0
  - mcp-use@1.0.0

## 2.0.2

### Patch Changes

- db54528: Migrated build system from tsc to tsup for faster builds (10-100x improvement) with dual CJS/ESM output support. This is an internal change that improves build performance without affecting the public API.
- Updated dependencies [db54528]
- Updated dependencies [db54528]
  - mcp-use@0.3.0
  - @mcp-use/inspector@0.2.1
