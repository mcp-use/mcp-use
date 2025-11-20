# create-mcp-use-app

## 0.5.1

### Patch Changes

- 835d367: add node types
- 835d367: make installation disabled by default and add deploy command to template package
- 835d367: fix templates deps
- fix: add missing vite dev dependencies to templates (vite, @vitejs/plugin-react, @tailwindcss/vite) for widget development

## 0.5.1-canary.2

### Patch Changes

- 6133446: make installation disabled by default and add deploy command to template package

## 0.5.1-canary.1

### Patch Changes

- bb270b1: add node types

## 0.5.1-canary.0

### Patch Changes

- dcdb472: fix templates deps

## 0.5.0

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

- 26e1162: Fixed canary flag not properly replacing package versions when using published templates. The `--canary` flag now correctly replaces both `workspace:*` patterns (in local development) and caret versions (in published packages) with `"canary"` versions of `mcp-use`, `@mcp-use/cli`, and `@mcp-use/inspector`.

## 0.5.0-canary.2

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

## 0.5.0-canary.1

### Patch Changes

- 9388edd: Fixed canary flag not properly replacing package versions when using published templates. The `--canary` flag now correctly replaces both `workspace:*` patterns (in local development) and caret versions (in published packages) with `"canary"` versions of `mcp-use`, `@mcp-use/cli`, and `@mcp-use/inspector`.

## 0.5.0-canary.0

### Minor Changes

- 3db425d: Migrated mcp-use server from Express to Hono framework to enable edge runtime support (Cloudflare Workers, Deno Deploy, Supabase Edge Functions). Added runtime detection for Deno/Node.js environments, Connect middleware adapter for compatibility, and `getHandler()` method for edge deployment. Updated dependencies: added `hono` and `@hono/node-server`, moved `connect` and `node-mocks-http` to optional dependencies, removed `express` and `cors` from peer dependencies.

  Added Supabase deployment documentation and example templates to create-mcp-use-app for easier edge runtime deployment.

## 0.4.10

### Patch Changes

- 410c67c: fix: defaults to starter rather than simple

## 0.4.10-canary.0

### Patch Changes

- 0b773d0: fix: defaults to starter rather than simple

## 0.4.9

### Patch Changes

- ceed51b: Standardize code formatting with ESLint + Prettier integration
  - Add Prettier for consistent code formatting across the monorepo
  - Integrate Prettier with ESLint via `eslint-config-prettier` to prevent conflicts
  - Configure pre-commit hooks with `lint-staged` to auto-format staged files
  - Add Prettier format checks to CI pipeline
  - Remove `@antfu/eslint-config` in favor of unified root ESLint configuration
  - Enforce semicolons and consistent code style with `.prettierrc.json`
  - Exclude markdown and JSON files from formatting via `.prettierignore`

## 0.4.9-canary.0

### Patch Changes

- 3f992c3: Standardize code formatting with ESLint + Prettier integration
  - Add Prettier for consistent code formatting across the monorepo
  - Integrate Prettier with ESLint via `eslint-config-prettier` to prevent conflicts
  - Configure pre-commit hooks with `lint-staged` to auto-format staged files
  - Add Prettier format checks to CI pipeline
  - Remove `@antfu/eslint-config` in favor of unified root ESLint configuration
  - Enforce semicolons and consistent code style with `.prettierrc.json`
  - Exclude markdown and JSON files from formatting via `.prettierignore`

## 0.4.8

### Patch Changes

- 708cc5b: update package.json
- 708cc5b: chore: set again cli and inspector as dependencies
- 708cc5b: fix: apps sdk metadata setup from widget build

## 0.4.8-canary.2

### Patch Changes

- a8e5b65: fix: apps sdk metadata setup from widget build

## 0.4.8-canary.1

### Patch Changes

- c8a89fc: chore: set again cli and inspector as dependencies

## 0.4.8-canary.0

### Patch Changes

- 507eb04: update package.json

## 0.4.7

### Patch Changes

- 80213e6: Readmes for templates

## 0.4.7-canary.0

### Patch Changes

- bce5d26: Readmes for templates

## 0.4.6

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

- 3c87c42: update package.json files to include @mcp-use/cli and @mcp-use/inspector as devDependencies in apps-sdk, mcp-ui, and starter templates
- 3c87c42: fix dev deps

## 0.4.6-canary.2

### Patch Changes

- 66cc1d9: fix dev deps

## 0.4.6-canary.1

### Patch Changes

- 113d2a3: update package.json files to include @mcp-use/cli and @mcp-use/inspector as devDependencies in apps-sdk, mcp-ui, and starter templates

## 0.4.6-canary.0

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

## 0.4.5

### Patch Changes

- 696b2e1: create-mcp-use app inits a git repository

## 0.4.5-canary.0

### Patch Changes

- b76bf22: create-mcp-use app inits a git repository

## 0.4.4

### Patch Changes

- 6dcee78: Add starter template + remove ui template
- 6dcee78: fix tests

## 0.4.4-canary.1

### Patch Changes

- d65eb3d: Add starter template + remove ui template

## 0.4.4-canary.0

### Patch Changes

- d507468: fix tests

## 0.4.3

### Patch Changes

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
