# @mcp-use/inspector

## 0.10.0

### Minor Changes

- 00b19c5: Add sampling support in inspector and fixed long running sampling requests (were timing out after 60s)

### Patch Changes

- Updated dependencies [00b19c5]
  - mcp-use@1.8.0

## 0.10.0-canary.0

### Minor Changes

- de6ca09: Add sampling support in inspector and fixed long running sampling requests (were timing out after 60s)

### Patch Changes

- Updated dependencies [de6ca09]
  - mcp-use@1.8.0-canary.0

## 0.9.2

### Patch Changes

- a4341d5: chore: update deps
- Updated dependencies [a4341d5]
  - mcp-use@1.7.2

## 0.9.2-canary.0

### Patch Changes

- c1d7378: chore: update deps
- Updated dependencies [c1d7378]
  - mcp-use@1.7.2-canary.0

## 0.9.1

### Patch Changes

- f6f2b61: ### Bug Fixes
  - **Fixed bin entry issue (#536)**: Resolved pnpm installation warning where bin entry referenced non-existent `./node_modules/@mcp-use/cli/dist/index.js` path. Created proper bin forwarding script at `./dist/src/bin.js` that allows users to run `mcp-use` CLI commands (dev, build, etc.) after installing the package.

  ### Improvements
  - Standardized import statement formatting across multiple files for improved code consistency and readability

- f6f2b61: fix lint & format
- Updated dependencies [f6f2b61]
- Updated dependencies [f6f2b61]
  - mcp-use@1.7.1

## 0.9.1-canary.1

### Patch Changes

- c9cb2db: fix lint & format
- Updated dependencies [c9cb2db]
  - mcp-use@1.7.1-canary.1

## 0.9.1-canary.0

### Patch Changes

- bab4ad0: ### Bug Fixes
  - **Fixed bin entry issue (#536)**: Resolved pnpm installation warning where bin entry referenced non-existent `./node_modules/@mcp-use/cli/dist/index.js` path. Created proper bin forwarding script at `./dist/src/bin.js` that allows users to run `mcp-use` CLI commands (dev, build, etc.) after installing the package.

  ### Improvements
  - Standardized import statement formatting across multiple files for improved code consistency and readability

- Updated dependencies [bab4ad0]
  - mcp-use@1.7.1-canary.0

## 0.9.0

### Minor Changes

- 2730902: ## New Features
  - **OAuth Authentication System**: Complete OAuth 2.0 support with built-in providers (Auth0, WorkOS, Supabase, Keycloak) and custom provider configuration
  - **OAuth Middleware & Routes**: Server-side OAuth flow handling with automatic token management and session persistence
  - **OAuth Callback Component**: Inspector now includes OAuth callback handling for authentication flows
  - **Context Storage**: New async local storage system for request-scoped context in servers
  - **Response Helpers**: Utility functions for standardized HTTP responses and error handling
  - **Runtime Detection**: Auto-detection utilities for Node.js, Bun, and Deno environments
  - **Server Authentication Examples**: Added OAuth examples for Auth0, WorkOS, and Supabase

  ## Improvements
  - **Enhanced useMcp Hook**: Improved connection management with better state handling and OAuth support
  - **Enhanced Inspector Dashboard**: Added OAuth configuration UI and connection status indicators
  - **Enhanced Browser Provider**: Better authentication flow handling with OAuth integration
  - **Improved Auto-Connect**: Enhanced connection recovery and auto-reconnect logic
  - **Enhanced Authentication Docs**: Comprehensive server-side authentication guide with OAuth setup instructions
  - **Renamed Notification Example**: Cleaner naming convention (notification-example → notifications)
  - **Enhanced Tool Types**: Improved type definitions for server-side tool handlers with context support
  - **Enhanced HTTP Connectors**: Added OAuth token handling in HTTP transport layer

  ## Documentation
  - Added server authentication guide
  - Enhanced client authentication documentation with OAuth flows
  - Added notification examples and usage patterns
  - Updated useMcp hook documentation with OAuth configuration

### Patch Changes

- 2730902: Fix scrolls in tools, resources, and prompts tab
- 2730902: Fix: switched to https://pkg.pr.new/modelcontextprotocol/typescript-sdk/@modelcontextprotocol/sdk@1194 instead of @modelcontextprotocol/sdk to fix zod errors on deno runtime
- 2730902: Optimized dependencies
- 2730902: Fix: fix models and apikeys box in inspector chat
- 2730902: Fix: rendering of table, inline-code, code and images of inspector chat
- 2730902: Fix padding of rpc panels
- 2730902: Feat: added enum input display for tools
- 2730902: feat: enable bundle minification 9.7mb -> 4.2 mb
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
  - mcp-use@1.7.0

## 0.9.0-canary.8

### Patch Changes

- mcp-use@1.7.0-canary.8

## 0.9.0-canary.7

### Patch Changes

- caf8c7c: Fix: switched to https://pkg.pr.new/modelcontextprotocol/typescript-sdk/@modelcontextprotocol/sdk@1194 instead of @modelcontextprotocol/sdk to fix zod errors on deno runtime
- Updated dependencies [caf8c7c]
- Updated dependencies [caf8c7c]
- Updated dependencies [caf8c7c]
  - mcp-use@1.7.0-canary.7

## 0.9.0-canary.6

### Patch Changes

- 38da68d: Fix: fix models and apikeys box in inspector chat
- 38da68d: Fix: rendering of table, inline-code, code and images of inspector chat
  - mcp-use@1.7.0-canary.6

## 0.9.0-canary.5

### Patch Changes

- 4b917e0: feat: enable bundle minification 9.7mb -> 4.2 mb
  - mcp-use@1.7.0-canary.5

## 0.9.0-canary.4

### Patch Changes

- f44e60f: Fix padding of rpc panels
  - mcp-use@1.7.0-canary.4

## 0.9.0-canary.3

### Patch Changes

- Updated dependencies [0c8cb1a]
  - mcp-use@1.7.0-canary.3

## 0.9.0-canary.2

### Patch Changes

- 1ca9801: Optimized dependencies
- Updated dependencies [1ca9801]
  - mcp-use@1.7.0-canary.2

## 0.9.0-canary.1

### Minor Changes

- 6bb0f3d: ## New Features
  - **OAuth Authentication System**: Complete OAuth 2.0 support with built-in providers (Auth0, WorkOS, Supabase, Keycloak) and custom provider configuration
  - **OAuth Middleware & Routes**: Server-side OAuth flow handling with automatic token management and session persistence
  - **OAuth Callback Component**: Inspector now includes OAuth callback handling for authentication flows
  - **Context Storage**: New async local storage system for request-scoped context in servers
  - **Response Helpers**: Utility functions for standardized HTTP responses and error handling
  - **Runtime Detection**: Auto-detection utilities for Node.js, Bun, and Deno environments
  - **Server Authentication Examples**: Added OAuth examples for Auth0, WorkOS, and Supabase

  ## Improvements
  - **Enhanced useMcp Hook**: Improved connection management with better state handling and OAuth support
  - **Enhanced Inspector Dashboard**: Added OAuth configuration UI and connection status indicators
  - **Enhanced Browser Provider**: Better authentication flow handling with OAuth integration
  - **Improved Auto-Connect**: Enhanced connection recovery and auto-reconnect logic
  - **Enhanced Authentication Docs**: Comprehensive server-side authentication guide with OAuth setup instructions
  - **Renamed Notification Example**: Cleaner naming convention (notification-example → notifications)
  - **Enhanced Tool Types**: Improved type definitions for server-side tool handlers with context support
  - **Enhanced HTTP Connectors**: Added OAuth token handling in HTTP transport layer

  ## Documentation
  - Added server authentication guide
  - Enhanced client authentication documentation with OAuth flows
  - Added notification examples and usage patterns
  - Updated useMcp hook documentation with OAuth configuration

### Patch Changes

- Updated dependencies [6bb0f3d]
  - mcp-use@1.7.0-canary.1

## 0.8.3-canary.0

### Patch Changes

- 041da75: Fix scrolls in tools, resources, and prompts tab
- 041da75: Feat: added enum input display for tools
  - mcp-use@1.6.3-canary.0

## 0.8.2

### Patch Changes

- 7e7c9a5: Downgrade mcp sdk to 22 due to https://github.com/modelcontextprotocol/typescript-sdk/issues/1182
- Updated dependencies [7e7c9a5]
  - mcp-use@1.6.2

## 0.8.2-canary.0

### Patch Changes

- 0530e6a: Downgrade mcp sdk to 22 due to https://github.com/modelcontextprotocol/typescript-sdk/issues/1182
- Updated dependencies [0530e6a]
  - mcp-use@1.6.2-canary.0

## 0.8.1

### Patch Changes

- 1a509bf: chore(deps): update @modelcontextprotocol/sdk to 1.23.0

  Updated @modelcontextprotocol/sdk dependency from 1.20.0 to 1.23.0.

- 1a509bf: remove console
- c8e30ec: Fix new sdk types
- Updated dependencies [1a509bf]
- Updated dependencies [c60c055]
- Updated dependencies [4950e56]
- Updated dependencies [1a509bf]
- Updated dependencies [c8e30ec]
  - mcp-use@1.6.1

## 0.8.1-canary.1

### Patch Changes

- mcp-use@1.6.1-canary.1

## 0.8.1-canary.0

### Patch Changes

- 9974d55: chore(deps): update @modelcontextprotocol/sdk to 1.23.0

  Updated @modelcontextprotocol/sdk dependency from 1.20.0 to 1.23.0.

- 299ce65: remove console
- 0e77821: Fix new sdk types
- Updated dependencies [9974d55]
- Updated dependencies [e9e4075]
- Updated dependencies [32c6790]
- Updated dependencies [299ce65]
- Updated dependencies [0e77821]
  - mcp-use@1.6.1-canary.0

## 0.8.0

### Minor Changes

- 7e4dd9b: ## Features
  - **Notifications**: Added bidirectional notification support between clients and servers. Clients can register notification handlers and servers can send targeted or broadcast notifications. Includes automatic handling of `list_changed` notifications per MCP spec.
  - **Sampling**: Implemented LLM sampling capabilities allowing MCP tools to request completions from connected clients. Clients can provide a `samplingCallback` to handle sampling requests, enabling tools to leverage client-side LLMs.
  - **Widget Build ID**: Added build ID support for widget UI resources to enable cache busting. Build IDs are automatically incorporated into widget URIs.
  - **Inspector Enhancements**: Added notifications tab with real-time notification display and server capabilities modal showing supported MCP capabilities.

  ## Improvements
  - **Session Management**: Refactored HTTP transport to reuse sessions across requests instead of creating new transports per request. Added session tracking with configurable idle timeout (default 5 minutes) and automatic cleanup. Sessions now maintain state across multiple requests, enabling targeted notifications to specific clients.
  - Enhanced HTTP connector with improved notification handling and sampling support
  - Added roots support in connectors and session API (`setRoots()`, `getRoots()`) for better file system integration
  - Added session event handling API (`session.on("notification")`) for registering notification handlers
  - Added server methods for session management (`getActiveSessions()`, `sendNotificationToSession()`) enabling targeted client communication
  - Added comprehensive examples for notifications and sampling features
  - Enhanced documentation for notifications and sampling functionality

- 7e4dd9b: ## New Features

  ### OpenAI Apps SDK Integration (`mcp-use` package)
  - **McpUseProvider** (`packages/mcp-use/src/react/McpUseProvider.tsx`) - New unified provider component that combines all common React setup for mcp-use widgets:
    - Automatically includes StrictMode, ThemeProvider, BrowserRouter with automatic basename calculation
    - Optional WidgetControls integration for debugging and view controls
    - ErrorBoundary wrapper for error handling
    - Auto-sizing support with ResizeObserver that calls `window.openai.notifyIntrinsicHeight()` for dynamic height updates
    - Automatic basename calculation for proper routing in both dev proxy and production environments
  - **WidgetControls** (`packages/mcp-use/src/react/WidgetControls.tsx`) - New component (752 lines) providing:
    - Debug button overlay for displaying widget debug information (props, state, theme, display mode, etc.)
    - View controls for fullscreen and picture-in-picture (PIP) modes
    - Shared hover logic for all control buttons
    - Customizable positioning (top-left, top-right, bottom-left, etc.)
    - Interactive debug overlay with tool testing capabilities
  - **useWidget hook** (`packages/mcp-use/src/react/useWidget.ts`) - New type-safe React adapter for OpenAI Apps SDK `window.openai` API:
    - Automatic props extraction from `toolInput`
    - Reactive state management subscribing to all OpenAI global changes
    - Access to theme, display mode, safe areas, locale, user agent
    - Action methods: `callTool`, `sendFollowUpMessage`, `openExternal`, `requestDisplayMode`, `setState`
    - Type-safe with full TypeScript support
  - **ErrorBoundary** (`packages/mcp-use/src/react/ErrorBoundary.tsx`) - New error boundary component for graceful error handling in widgets
  - **Image** (`packages/mcp-use/src/react/Image.tsx`) - New image component that handles both data URLs and public file paths for widgets
  - **ThemeProvider** (`packages/mcp-use/src/react/ThemeProvider.tsx`) - New theme provider component for consistent theme management across widgets

  ### Inspector Widget Support
  - **WidgetInspectorControls** (`packages/inspector/src/client/components/WidgetInspectorControls.tsx`) - New component (364 lines) providing:
    - Inspector-specific widget controls and debugging interface
    - Widget state inspection with real-time updates
    - Debug information display including props, output, metadata, and state
    - Integration with inspector's tool execution flow
  - **Console Proxy Toggle** (`packages/inspector/src/client/components/IframeConsole.tsx` and `packages/inspector/src/client/hooks/useIframeConsole.ts`):
    - New toggle option to proxy iframe console logs to the page console
    - Persistent preference stored in localStorage
    - Improved console UI with tooltips and better error/warning indicators
    - Formatted console output with appropriate log levels

  ### Enhanced Apps SDK Template
  - **Product Search Result Widget** (`packages/create-mcp-use-app/src/templates/apps-sdk/resources/product-search-result/`):
    - Complete ecommerce widget example with carousel, accordion, and product display components
    - Carousel component (`components/Carousel.tsx`) with smooth animations and transitions
    - Accordion components (`components/Accordion.tsx`, `components/AccordionItem.tsx`) for collapsible content
    - Fruits API integration using `@tanstack/react-query` for data fetching
    - 16 fruit product images added to `public/fruits/` directory (apple, apricot, avocado, banana, blueberry, cherries, coconut, grapes, lemon, mango, orange, pear, pineapple, plum, strawberry, watermelon)
    - Enhanced product display with filtering and search capabilities
  - **Updated Template Example** (`packages/create-mcp-use-app/src/templates/apps-sdk/index.ts`):
    - New `get-brand-info` tool replacing the old `get-my-city` example
    - Fruits API endpoint (`/api/fruits`) for template data
    - Better example demonstrating brand information retrieval

  ### CLI Widget Building Enhancements
  - **Folder-based Widget Support** (`packages/cli/src/index.ts` and `packages/mcp-use/src/server/mcp-server.ts`):
    - Support for widgets organized in folders with `widget.tsx` entry point
    - Automatic detection of both single-file widgets and folder-based widgets
    - Proper widget name resolution from folder names
  - **Public Folder Support** (`packages/cli/src/index.ts`):
    - Automatic copying of `public/` folder to `dist/public/` during build
    - Support for static assets in widget templates
  - **Enhanced SSR Configuration** (`packages/cli/src/index.ts`):
    - Improved Vite SSR configuration with proper `noExternal` settings for `@openai/apps-sdk-ui` and `react-router`
    - Better environment variable definitions for SSR context
    - CSS handling plugin for SSR mode
  - **Dev Server Public Assets** (`packages/mcp-use/src/server/mcp-server.ts`):
    - New `/mcp-use/public/*` route for serving static files in development mode
    - Proper content-type detection for various file types (images, fonts, etc.)

  ## Improvements

  ### Inspector Component Enhancements
  - **OpenAIComponentRenderer** (`packages/inspector/src/client/components/OpenAIComponentRenderer.tsx`):
    - Added `memo` wrapper for performance optimization
    - Enhanced `notifyIntrinsicHeight` message handling with proper height calculation and capping for different display modes
    - Improved theme support to prevent theme flashing on widget load by passing theme in widget data
    - Widget state inspection support via `mcp-inspector:getWidgetState` message handling
    - Better dev mode detection and widget URL generation
    - Enhanced CSP handling with dev server URL support
  - **ToolResultDisplay** (`packages/inspector/src/client/components/tools/ToolResultDisplay.tsx`) - Major refactor (894 lines changed):
    - New formatted content display supporting multiple content types:
      - Text content with JSON detection and formatting
      - Image content with base64 data URL rendering
      - Audio content with player controls
      - Resource links with full metadata display
      - Embedded resources with content preview
    - Result history navigation with dropdown selector
    - Relative time display (e.g., "2m ago", "1h ago")
    - JSON validation and automatic formatting
    - Maximize/restore functionality for result panel
    - Better visual organization with content type labels
  - **ToolsTab** (`packages/inspector/src/client/components/ToolsTab.tsx`):
    - Resizable panels with collapse support using refs
    - Maximize functionality for result panel that collapses left and top panels
    - Better mobile view handling and responsive design
    - Improved panel state management

  ### Server-Side Improvements
  - **shared-routes.ts** (`packages/inspector/src/server/shared-routes.ts`):
    - Enhanced dev widget proxy with better asset loading
    - Direct asset loading from dev server for simplicity (avoids HTML rewriting issues)
    - CSP violation warnings injected into HTML for development debugging
    - Improved Vite HMR WebSocket handling with direct connection to dev server
    - Base tag injection for proper routing and dynamic module loading
    - Better CSP header generation supporting both production and development modes
  - **shared-utils.ts** and **shared-utils-browser.ts** (`packages/inspector/src/server/`):
    - Enhanced widget security headers with dev server URL support
    - Improved CSP configuration separating production and development resource domains
    - Theme support in widget data for preventing theme flash
    - Widget state inspection message handling
    - `notifyIntrinsicHeight` API support in browser version
    - MCP widget utilities injection (`__mcpPublicUrl`, `__getFile`) for Image component support
    - Better history management to prevent redirects in inspector dev-widget proxy

  ### Template Improvements
  - **apps-sdk template** (`packages/create-mcp-use-app/src/templates/apps-sdk/`):
    - Updated README with comprehensive documentation:
      - Official UI components integration guide
      - Ecommerce widgets documentation
      - Better examples and usage instructions
    - Enhanced example tool (`get-brand-info`) with complete brand information structure
    - Fruits API endpoint for template data
    - Better styling and theming support
    - Removed outdated `display-weather.tsx` widget
  - **Template Styles** (`packages/create-mcp-use-app/src/templates/apps-sdk/styles.css`):
    - Enhanced CSS with better theming support
    - Improved component styling

  ### CLI Improvements
  - **CLI index.ts** (`packages/cli/src/index.ts`):
    - Better server waiting mechanism using `AbortController` for proper cleanup
    - Enhanced fetch request with proper headers and signal handling
    - Support for folder-based widgets with proper entry path resolution
    - Public folder copying during build process
    - Enhanced SSR configuration with proper Vite settings
    - Better error handling throughout

  ### Code Quality
  - Improved logging throughout the codebase with better context and formatting
  - Better code formatting and readability improvements
  - Enhanced type safety with proper TypeScript types
  - Better error handling with try-catch blocks and proper error messages
  - Consistent code organization and structure

  ## Bug Fixes

  ### Widget Rendering
  - Fixed iframe height calculation issues by properly handling `notifyIntrinsicHeight` messages and respecting display mode constraints
  - Fixed theme flashing on widget load by passing theme in widget data and using it in initial API setup
  - Fixed CSP header generation for dev mode by properly handling dev server URLs in CSP configuration
  - Fixed asset loading in dev widget proxy by using direct URLs to dev server instead of proxy rewriting

  ### Inspector Issues
  - Fixed console logging in iframe by improving message handling and adding proxy toggle functionality
  - Fixed widget state inspection by adding proper message handling for `mcp-inspector:getWidgetState` requests
  - Fixed resizable panel collapse behavior by using refs and proper state management
  - Fixed mobile view handling with better responsive design and view state management

  ### Build Process
  - Fixed widget metadata extraction by properly handling folder-based widgets and entry paths
  - Fixed Vite SSR configuration by adding proper `noExternal` settings and environment definitions
  - Fixed public asset copying by adding explicit copy step in build process
  - Fixed widget name resolution for folder-based widgets by using folder name instead of file name

  ### Documentation
  - Fixed Supabase deployment script (`packages/mcp-use/examples/server/supabase/deploy.sh`) with updated project creation syntax
  - Updated deployment command in Supabase documentation to reflect new project creation syntax
  - Added server inspection URL to Supabase deployment documentation (`docs/typescript/server/deployment-supabase.mdx`)

  ### Other Fixes
  - Fixed history management to prevent unwanted redirects when running widgets in inspector dev-widget proxy
  - Fixed macOS resource fork file exclusion in widget discovery (`.DS_Store`, `._*` files)
  - Fixed Vite HMR WebSocket connection by using direct dev server URLs instead of proxy
  - Fixed CSS imports in SSR mode by adding custom plugin to handle CSS files properly

- 7e4dd9b: Release canary
- 7e4dd9b: Added support for rpc messages logging in inspector

### Patch Changes

- 7e4dd9b: fix versions
- 7e4dd9b: **Bug Fixes:**
  - Fixed auto-connect proxy fallback behavior - now properly retries with proxy when direct connection fails
  - Fixed connection config updates not applying when connection already exists
  - Fixed connection wrapper not re-rendering when proxy config changes

  **Improvements:**
  - Auto-switch (proxy fallback) now automatically enabled during auto-connect flow
  - Added automatic navigation to home page after connection failures
  - Improved error messages for connection failures
  - Enhanced state cleanup on connection retry and failure scenarios

- 7e4dd9b: - **Security**: Added `https://*.openai.com` to Content Security Policy trusted domains for widgets
  - **Type safety**: Exported `WidgetMetadata` type from `mcp-use/react` for better widget development experience
  - **Templates**: Updated widget templates to use `WidgetMetadata` type and fixed CSS import paths (moved styles to resources directory)
  - **Documentation**: Added comprehensive Apps SDK metadata documentation including CSP configuration examples
- 7e4dd9b: - Fix OpenAI Apps SDK UI theme synchronization by setting data-theme attribute and color-scheme on iframe document
  - Replace hardcoded Tailwind color classes with design tokens in create-mcp-use-app template components
  - Fix collapsed panel size from 5 to 6 in Prompts, Resources, and Tools tabs
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
- Updated dependencies [7e4dd9b]
  - mcp-use@1.6.0

## 0.7.1-canary.7

### Patch Changes

- 94b9824: **Bug Fixes:**
  - Fixed auto-connect proxy fallback behavior - now properly retries with proxy when direct connection fails
  - Fixed connection config updates not applying when connection already exists
  - Fixed connection wrapper not re-rendering when proxy config changes

  **Improvements:**
  - Auto-switch (proxy fallback) now automatically enabled during auto-connect flow
  - Added automatic navigation to home page after connection failures
  - Improved error messages for connection failures
  - Enhanced state cleanup on connection retry and failure scenarios

- Updated dependencies [94b9824]
  - mcp-use@1.5.1-canary.7

## 0.7.1-canary.6

### Patch Changes

- Updated dependencies [a3295a0]
  - mcp-use@1.5.1-canary.6

## 0.7.1-canary.5

### Patch Changes

- Updated dependencies [95fa604]
  - mcp-use@1.5.1-canary.5

## 0.7.1-canary.4

### Patch Changes

- Updated dependencies [a93befb]
  - mcp-use@1.5.1-canary.4

## 0.7.1-canary.3

### Patch Changes

- Updated dependencies [ccc2df3]
  - mcp-use@1.5.1-canary.3

## 0.7.1-canary.2

### Patch Changes

- Updated dependencies [e5e8e1b]
  - mcp-use@1.5.1-canary.2

## 0.7.1-canary.1

### Patch Changes

- Updated dependencies [4ca7772]
  - mcp-use@1.5.1-canary.1

## 0.7.1-canary.0

### Patch Changes

- 12a88c7: fix versions
- Updated dependencies [12a88c7]
  - mcp-use@1.5.1-canary.0

## 0.7.0

### Minor Changes

- 266a445: ## New Features

  ### OpenAI Apps SDK Integration (`mcp-use` package)
  - **McpUseProvider** (`packages/mcp-use/src/react/McpUseProvider.tsx`) - New unified provider component that combines all common React setup for mcp-use widgets:
    - Automatically includes StrictMode, ThemeProvider, BrowserRouter with automatic basename calculation
    - Optional WidgetControls integration for debugging and view controls
    - ErrorBoundary wrapper for error handling
    - Auto-sizing support with ResizeObserver that calls `window.openai.notifyIntrinsicHeight()` for dynamic height updates
    - Automatic basename calculation for proper routing in both dev proxy and production environments
  - **WidgetControls** (`packages/mcp-use/src/react/WidgetControls.tsx`) - New component (752 lines) providing:
    - Debug button overlay for displaying widget debug information (props, state, theme, display mode, etc.)
    - View controls for fullscreen and picture-in-picture (PIP) modes
    - Shared hover logic for all control buttons
    - Customizable positioning (top-left, top-right, bottom-left, etc.)
    - Interactive debug overlay with tool testing capabilities
  - **useWidget hook** (`packages/mcp-use/src/react/useWidget.ts`) - New type-safe React adapter for OpenAI Apps SDK `window.openai` API:
    - Automatic props extraction from `toolInput`
    - Reactive state management subscribing to all OpenAI global changes
    - Access to theme, display mode, safe areas, locale, user agent
    - Action methods: `callTool`, `sendFollowUpMessage`, `openExternal`, `requestDisplayMode`, `setState`
    - Type-safe with full TypeScript support
  - **ErrorBoundary** (`packages/mcp-use/src/react/ErrorBoundary.tsx`) - New error boundary component for graceful error handling in widgets
  - **Image** (`packages/mcp-use/src/react/Image.tsx`) - New image component that handles both data URLs and public file paths for widgets
  - **ThemeProvider** (`packages/mcp-use/src/react/ThemeProvider.tsx`) - New theme provider component for consistent theme management across widgets

  ### Inspector Widget Support
  - **WidgetInspectorControls** (`packages/inspector/src/client/components/WidgetInspectorControls.tsx`) - New component (364 lines) providing:
    - Inspector-specific widget controls and debugging interface
    - Widget state inspection with real-time updates
    - Debug information display including props, output, metadata, and state
    - Integration with inspector's tool execution flow
  - **Console Proxy Toggle** (`packages/inspector/src/client/components/IframeConsole.tsx` and `packages/inspector/src/client/hooks/useIframeConsole.ts`):
    - New toggle option to proxy iframe console logs to the page console
    - Persistent preference stored in localStorage
    - Improved console UI with tooltips and better error/warning indicators
    - Formatted console output with appropriate log levels

  ### Enhanced Apps SDK Template
  - **Product Search Result Widget** (`packages/create-mcp-use-app/src/templates/apps-sdk/resources/product-search-result/`):
    - Complete ecommerce widget example with carousel, accordion, and product display components
    - Carousel component (`components/Carousel.tsx`) with smooth animations and transitions
    - Accordion components (`components/Accordion.tsx`, `components/AccordionItem.tsx`) for collapsible content
    - Fruits API integration using `@tanstack/react-query` for data fetching
    - 16 fruit product images added to `public/fruits/` directory (apple, apricot, avocado, banana, blueberry, cherries, coconut, grapes, lemon, mango, orange, pear, pineapple, plum, strawberry, watermelon)
    - Enhanced product display with filtering and search capabilities
  - **Updated Template Example** (`packages/create-mcp-use-app/src/templates/apps-sdk/index.ts`):
    - New `get-brand-info` tool replacing the old `get-my-city` example
    - Fruits API endpoint (`/api/fruits`) for template data
    - Better example demonstrating brand information retrieval

  ### CLI Widget Building Enhancements
  - **Folder-based Widget Support** (`packages/cli/src/index.ts` and `packages/mcp-use/src/server/mcp-server.ts`):
    - Support for widgets organized in folders with `widget.tsx` entry point
    - Automatic detection of both single-file widgets and folder-based widgets
    - Proper widget name resolution from folder names
  - **Public Folder Support** (`packages/cli/src/index.ts`):
    - Automatic copying of `public/` folder to `dist/public/` during build
    - Support for static assets in widget templates
  - **Enhanced SSR Configuration** (`packages/cli/src/index.ts`):
    - Improved Vite SSR configuration with proper `noExternal` settings for `@openai/apps-sdk-ui` and `react-router`
    - Better environment variable definitions for SSR context
    - CSS handling plugin for SSR mode
  - **Dev Server Public Assets** (`packages/mcp-use/src/server/mcp-server.ts`):
    - New `/mcp-use/public/*` route for serving static files in development mode
    - Proper content-type detection for various file types (images, fonts, etc.)

  ## Improvements

  ### Inspector Component Enhancements
  - **OpenAIComponentRenderer** (`packages/inspector/src/client/components/OpenAIComponentRenderer.tsx`):
    - Added `memo` wrapper for performance optimization
    - Enhanced `notifyIntrinsicHeight` message handling with proper height calculation and capping for different display modes
    - Improved theme support to prevent theme flashing on widget load by passing theme in widget data
    - Widget state inspection support via `mcp-inspector:getWidgetState` message handling
    - Better dev mode detection and widget URL generation
    - Enhanced CSP handling with dev server URL support
  - **ToolResultDisplay** (`packages/inspector/src/client/components/tools/ToolResultDisplay.tsx`) - Major refactor (894 lines changed):
    - New formatted content display supporting multiple content types:
      - Text content with JSON detection and formatting
      - Image content with base64 data URL rendering
      - Audio content with player controls
      - Resource links with full metadata display
      - Embedded resources with content preview
    - Result history navigation with dropdown selector
    - Relative time display (e.g., "2m ago", "1h ago")
    - JSON validation and automatic formatting
    - Maximize/restore functionality for result panel
    - Better visual organization with content type labels
  - **ToolsTab** (`packages/inspector/src/client/components/ToolsTab.tsx`):
    - Resizable panels with collapse support using refs
    - Maximize functionality for result panel that collapses left and top panels
    - Better mobile view handling and responsive design
    - Improved panel state management

  ### Server-Side Improvements
  - **shared-routes.ts** (`packages/inspector/src/server/shared-routes.ts`):
    - Enhanced dev widget proxy with better asset loading
    - Direct asset loading from dev server for simplicity (avoids HTML rewriting issues)
    - CSP violation warnings injected into HTML for development debugging
    - Improved Vite HMR WebSocket handling with direct connection to dev server
    - Base tag injection for proper routing and dynamic module loading
    - Better CSP header generation supporting both production and development modes
  - **shared-utils.ts** and **shared-utils-browser.ts** (`packages/inspector/src/server/`):
    - Enhanced widget security headers with dev server URL support
    - Improved CSP configuration separating production and development resource domains
    - Theme support in widget data for preventing theme flash
    - Widget state inspection message handling
    - `notifyIntrinsicHeight` API support in browser version
    - MCP widget utilities injection (`__mcpPublicUrl`, `__getFile`) for Image component support
    - Better history management to prevent redirects in inspector dev-widget proxy

  ### Template Improvements
  - **apps-sdk template** (`packages/create-mcp-use-app/src/templates/apps-sdk/`):
    - Updated README with comprehensive documentation:
      - Official UI components integration guide
      - Ecommerce widgets documentation
      - Better examples and usage instructions
    - Enhanced example tool (`get-brand-info`) with complete brand information structure
    - Fruits API endpoint for template data
    - Better styling and theming support
    - Removed outdated `display-weather.tsx` widget
  - **Template Styles** (`packages/create-mcp-use-app/src/templates/apps-sdk/styles.css`):
    - Enhanced CSS with better theming support
    - Improved component styling

  ### CLI Improvements
  - **CLI index.ts** (`packages/cli/src/index.ts`):
    - Better server waiting mechanism using `AbortController` for proper cleanup
    - Enhanced fetch request with proper headers and signal handling
    - Support for folder-based widgets with proper entry path resolution
    - Public folder copying during build process
    - Enhanced SSR configuration with proper Vite settings
    - Better error handling throughout

  ### Code Quality
  - Improved logging throughout the codebase with better context and formatting
  - Better code formatting and readability improvements
  - Enhanced type safety with proper TypeScript types
  - Better error handling with try-catch blocks and proper error messages
  - Consistent code organization and structure

  ## Bug Fixes

  ### Widget Rendering
  - Fixed iframe height calculation issues by properly handling `notifyIntrinsicHeight` messages and respecting display mode constraints
  - Fixed theme flashing on widget load by passing theme in widget data and using it in initial API setup
  - Fixed CSP header generation for dev mode by properly handling dev server URLs in CSP configuration
  - Fixed asset loading in dev widget proxy by using direct URLs to dev server instead of proxy rewriting

  ### Inspector Issues
  - Fixed console logging in iframe by improving message handling and adding proxy toggle functionality
  - Fixed widget state inspection by adding proper message handling for `mcp-inspector:getWidgetState` requests
  - Fixed resizable panel collapse behavior by using refs and proper state management
  - Fixed mobile view handling with better responsive design and view state management

  ### Build Process
  - Fixed widget metadata extraction by properly handling folder-based widgets and entry paths
  - Fixed Vite SSR configuration by adding proper `noExternal` settings and environment definitions
  - Fixed public asset copying by adding explicit copy step in build process
  - Fixed widget name resolution for folder-based widgets by using folder name instead of file name

  ### Documentation
  - Fixed Supabase deployment script (`packages/mcp-use/examples/server/supabase/deploy.sh`) with updated project creation syntax
  - Updated deployment command in Supabase documentation to reflect new project creation syntax
  - Added server inspection URL to Supabase deployment documentation (`docs/typescript/server/deployment-supabase.mdx`)

  ### Other Fixes
  - Fixed history management to prevent unwanted redirects when running widgets in inspector dev-widget proxy
  - Fixed macOS resource fork file exclusion in widget discovery (`.DS_Store`, `._*` files)
  - Fixed Vite HMR WebSocket connection by using direct dev server URLs instead of proxy
  - Fixed CSS imports in SSR mode by adding custom plugin to handle CSS files properly

- 266a445: Release canary
- 266a445: Added support for rpc messages logging in inspector

### Patch Changes

- Updated dependencies [266a445]
- Updated dependencies [266a445]
- Updated dependencies [266a445]
- Updated dependencies [266a445]
  - mcp-use@1.5.0

## 0.7.0-canary.3

### Minor Changes

- 018395c: Release canary

### Patch Changes

- Updated dependencies [018395c]
  - mcp-use@1.5.0-canary.3

## 0.7.0-canary.2

### Minor Changes

- 229a3a3: Added support for rpc messages logging in inspector

### Patch Changes

- Updated dependencies [229a3a3]
  - mcp-use@1.5.0-canary.2

## 0.7.0-canary.1

### Minor Changes

- fc64bd7: ## New Features

  ### OpenAI Apps SDK Integration (`mcp-use` package)
  - **McpUseProvider** (`packages/mcp-use/src/react/McpUseProvider.tsx`) - New unified provider component that combines all common React setup for mcp-use widgets:
    - Automatically includes StrictMode, ThemeProvider, BrowserRouter with automatic basename calculation
    - Optional WidgetControls integration for debugging and view controls
    - ErrorBoundary wrapper for error handling
    - Auto-sizing support with ResizeObserver that calls `window.openai.notifyIntrinsicHeight()` for dynamic height updates
    - Automatic basename calculation for proper routing in both dev proxy and production environments
  - **WidgetControls** (`packages/mcp-use/src/react/WidgetControls.tsx`) - New component (752 lines) providing:
    - Debug button overlay for displaying widget debug information (props, state, theme, display mode, etc.)
    - View controls for fullscreen and picture-in-picture (PIP) modes
    - Shared hover logic for all control buttons
    - Customizable positioning (top-left, top-right, bottom-left, etc.)
    - Interactive debug overlay with tool testing capabilities
  - **useWidget hook** (`packages/mcp-use/src/react/useWidget.ts`) - New type-safe React adapter for OpenAI Apps SDK `window.openai` API:
    - Automatic props extraction from `toolInput`
    - Reactive state management subscribing to all OpenAI global changes
    - Access to theme, display mode, safe areas, locale, user agent
    - Action methods: `callTool`, `sendFollowUpMessage`, `openExternal`, `requestDisplayMode`, `setState`
    - Type-safe with full TypeScript support
  - **ErrorBoundary** (`packages/mcp-use/src/react/ErrorBoundary.tsx`) - New error boundary component for graceful error handling in widgets
  - **Image** (`packages/mcp-use/src/react/Image.tsx`) - New image component that handles both data URLs and public file paths for widgets
  - **ThemeProvider** (`packages/mcp-use/src/react/ThemeProvider.tsx`) - New theme provider component for consistent theme management across widgets

  ### Inspector Widget Support
  - **WidgetInspectorControls** (`packages/inspector/src/client/components/WidgetInspectorControls.tsx`) - New component (364 lines) providing:
    - Inspector-specific widget controls and debugging interface
    - Widget state inspection with real-time updates
    - Debug information display including props, output, metadata, and state
    - Integration with inspector's tool execution flow
  - **Console Proxy Toggle** (`packages/inspector/src/client/components/IframeConsole.tsx` and `packages/inspector/src/client/hooks/useIframeConsole.ts`):
    - New toggle option to proxy iframe console logs to the page console
    - Persistent preference stored in localStorage
    - Improved console UI with tooltips and better error/warning indicators
    - Formatted console output with appropriate log levels

  ### Enhanced Apps SDK Template
  - **Product Search Result Widget** (`packages/create-mcp-use-app/src/templates/apps-sdk/resources/product-search-result/`):
    - Complete ecommerce widget example with carousel, accordion, and product display components
    - Carousel component (`components/Carousel.tsx`) with smooth animations and transitions
    - Accordion components (`components/Accordion.tsx`, `components/AccordionItem.tsx`) for collapsible content
    - Fruits API integration using `@tanstack/react-query` for data fetching
    - 16 fruit product images added to `public/fruits/` directory (apple, apricot, avocado, banana, blueberry, cherries, coconut, grapes, lemon, mango, orange, pear, pineapple, plum, strawberry, watermelon)
    - Enhanced product display with filtering and search capabilities
  - **Updated Template Example** (`packages/create-mcp-use-app/src/templates/apps-sdk/index.ts`):
    - New `get-brand-info` tool replacing the old `get-my-city` example
    - Fruits API endpoint (`/api/fruits`) for template data
    - Better example demonstrating brand information retrieval

  ### CLI Widget Building Enhancements
  - **Folder-based Widget Support** (`packages/cli/src/index.ts` and `packages/mcp-use/src/server/mcp-server.ts`):
    - Support for widgets organized in folders with `widget.tsx` entry point
    - Automatic detection of both single-file widgets and folder-based widgets
    - Proper widget name resolution from folder names
  - **Public Folder Support** (`packages/cli/src/index.ts`):
    - Automatic copying of `public/` folder to `dist/public/` during build
    - Support for static assets in widget templates
  - **Enhanced SSR Configuration** (`packages/cli/src/index.ts`):
    - Improved Vite SSR configuration with proper `noExternal` settings for `@openai/apps-sdk-ui` and `react-router`
    - Better environment variable definitions for SSR context
    - CSS handling plugin for SSR mode
  - **Dev Server Public Assets** (`packages/mcp-use/src/server/mcp-server.ts`):
    - New `/mcp-use/public/*` route for serving static files in development mode
    - Proper content-type detection for various file types (images, fonts, etc.)

  ## Improvements

  ### Inspector Component Enhancements
  - **OpenAIComponentRenderer** (`packages/inspector/src/client/components/OpenAIComponentRenderer.tsx`):
    - Added `memo` wrapper for performance optimization
    - Enhanced `notifyIntrinsicHeight` message handling with proper height calculation and capping for different display modes
    - Improved theme support to prevent theme flashing on widget load by passing theme in widget data
    - Widget state inspection support via `mcp-inspector:getWidgetState` message handling
    - Better dev mode detection and widget URL generation
    - Enhanced CSP handling with dev server URL support
  - **ToolResultDisplay** (`packages/inspector/src/client/components/tools/ToolResultDisplay.tsx`) - Major refactor (894 lines changed):
    - New formatted content display supporting multiple content types:
      - Text content with JSON detection and formatting
      - Image content with base64 data URL rendering
      - Audio content with player controls
      - Resource links with full metadata display
      - Embedded resources with content preview
    - Result history navigation with dropdown selector
    - Relative time display (e.g., "2m ago", "1h ago")
    - JSON validation and automatic formatting
    - Maximize/restore functionality for result panel
    - Better visual organization with content type labels
  - **ToolsTab** (`packages/inspector/src/client/components/ToolsTab.tsx`):
    - Resizable panels with collapse support using refs
    - Maximize functionality for result panel that collapses left and top panels
    - Better mobile view handling and responsive design
    - Improved panel state management

  ### Server-Side Improvements
  - **shared-routes.ts** (`packages/inspector/src/server/shared-routes.ts`):
    - Enhanced dev widget proxy with better asset loading
    - Direct asset loading from dev server for simplicity (avoids HTML rewriting issues)
    - CSP violation warnings injected into HTML for development debugging
    - Improved Vite HMR WebSocket handling with direct connection to dev server
    - Base tag injection for proper routing and dynamic module loading
    - Better CSP header generation supporting both production and development modes
  - **shared-utils.ts** and **shared-utils-browser.ts** (`packages/inspector/src/server/`):
    - Enhanced widget security headers with dev server URL support
    - Improved CSP configuration separating production and development resource domains
    - Theme support in widget data for preventing theme flash
    - Widget state inspection message handling
    - `notifyIntrinsicHeight` API support in browser version
    - MCP widget utilities injection (`__mcpPublicUrl`, `__getFile`) for Image component support
    - Better history management to prevent redirects in inspector dev-widget proxy

  ### Template Improvements
  - **apps-sdk template** (`packages/create-mcp-use-app/src/templates/apps-sdk/`):
    - Updated README with comprehensive documentation:
      - Official UI components integration guide
      - Ecommerce widgets documentation
      - Better examples and usage instructions
    - Enhanced example tool (`get-brand-info`) with complete brand information structure
    - Fruits API endpoint for template data
    - Better styling and theming support
    - Removed outdated `display-weather.tsx` widget
  - **Template Styles** (`packages/create-mcp-use-app/src/templates/apps-sdk/styles.css`):
    - Enhanced CSS with better theming support
    - Improved component styling

  ### CLI Improvements
  - **CLI index.ts** (`packages/cli/src/index.ts`):
    - Better server waiting mechanism using `AbortController` for proper cleanup
    - Enhanced fetch request with proper headers and signal handling
    - Support for folder-based widgets with proper entry path resolution
    - Public folder copying during build process
    - Enhanced SSR configuration with proper Vite settings
    - Better error handling throughout

  ### Code Quality
  - Improved logging throughout the codebase with better context and formatting
  - Better code formatting and readability improvements
  - Enhanced type safety with proper TypeScript types
  - Better error handling with try-catch blocks and proper error messages
  - Consistent code organization and structure

  ## Bug Fixes

  ### Widget Rendering
  - Fixed iframe height calculation issues by properly handling `notifyIntrinsicHeight` messages and respecting display mode constraints
  - Fixed theme flashing on widget load by passing theme in widget data and using it in initial API setup
  - Fixed CSP header generation for dev mode by properly handling dev server URLs in CSP configuration
  - Fixed asset loading in dev widget proxy by using direct URLs to dev server instead of proxy rewriting

  ### Inspector Issues
  - Fixed console logging in iframe by improving message handling and adding proxy toggle functionality
  - Fixed widget state inspection by adding proper message handling for `mcp-inspector:getWidgetState` requests
  - Fixed resizable panel collapse behavior by using refs and proper state management
  - Fixed mobile view handling with better responsive design and view state management

  ### Build Process
  - Fixed widget metadata extraction by properly handling folder-based widgets and entry paths
  - Fixed Vite SSR configuration by adding proper `noExternal` settings and environment definitions
  - Fixed public asset copying by adding explicit copy step in build process
  - Fixed widget name resolution for folder-based widgets by using folder name instead of file name

  ### Documentation
  - Fixed Supabase deployment script (`packages/mcp-use/examples/server/supabase/deploy.sh`) with updated project creation syntax
  - Updated deployment command in Supabase documentation to reflect new project creation syntax
  - Added server inspection URL to Supabase deployment documentation (`docs/typescript/server/deployment-supabase.mdx`)

  ### Other Fixes
  - Fixed history management to prevent unwanted redirects when running widgets in inspector dev-widget proxy
  - Fixed macOS resource fork file exclusion in widget discovery (`.DS_Store`, `._*` files)
  - Fixed Vite HMR WebSocket connection by using direct dev server URLs instead of proxy
  - Fixed CSS imports in SSR mode by adding custom plugin to handle CSS files properly

### Patch Changes

- Updated dependencies [fc64bd7]
  - mcp-use@1.5.0-canary.1

## 0.6.1

### Patch Changes

- Updated dependencies [95c9d9f]
- Updated dependencies [95c9d9f]
  - mcp-use@1.4.1

## 0.6.1-canary.1

### Patch Changes

- Updated dependencies [0975320]
  - mcp-use@1.4.1-canary.1

## 0.6.1-canary.0

### Patch Changes

- Updated dependencies [d434691]
  - mcp-use@1.4.1-canary.0

## 0.6.0

### Minor Changes

- 33e4a68: Responsive design for inspector :O

### Patch Changes

- 33e4a68: Remove debugger button from pip mode to avoid overlap with close button
- Updated dependencies [33e4a68]
  - mcp-use@1.4.0

## 0.6.0-canary.3

### Patch Changes

- Updated dependencies [35fd9ae]
  - mcp-use@1.4.0-canary.3

## 0.6.0-canary.2

### Patch Changes

- mcp-use@1.3.4-canary.2

## 0.6.0-canary.1

### Patch Changes

- 451c507: Remove debugger button from pip mode to avoid overlap with close button
  - mcp-use@1.3.4-canary.1

## 0.6.0-canary.0

### Minor Changes

- 1f4a798: Responsive design for inspector :O

### Patch Changes

- mcp-use@1.3.4-canary.0

## 0.5.3

### Patch Changes

- e8ec993: Fix formatting of object tool input
- e8ec993: Add support for displaying console logs of widgets in the inspector preview panel
- e8ec993: - Add emulation of openai api to the inspector
  - Add utility component WidgetFullscreenWrapper: render full screen and pip buttons
  - Add utility component WidgetDebugger: shows an overlay with openai metadata for debugging ChatGPT integration
- e8ec993: Fix connection edit button in inspector
- e8ec993: Fix button overflow in connect form
- e8ec993: Dynamically load models for the chat
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
  - mcp-use@1.3.3

## 0.5.3-canary.8

### Patch Changes

- 329ce35: Dynamically load models for the chat
  - mcp-use@1.3.3-canary.8

## 0.5.3-canary.7

### Patch Changes

- 1ed0ab8: Fix formatting of object tool input
  - mcp-use@1.3.3-canary.7

## 0.5.3-canary.6

### Patch Changes

- ba654db: Fix button overflow in connect form
  - mcp-use@1.3.3-canary.6

## 0.5.3-canary.5

### Patch Changes

- f971dd8: Fix connection edit button in inspector
  - mcp-use@1.3.3-canary.5

## 0.5.3-canary.4

### Patch Changes

- 68d0d4c: - Add emulation of openai api to the inspector
  - Add utility component WidgetFullscreenWrapper: render full screen and pip buttons
  - Add utility component WidgetDebugger: shows an overlay with openai metadata for debugging ChatGPT integration
- Updated dependencies [68d0d4c]
  - mcp-use@1.3.3-canary.4

## 0.5.3-canary.3

### Patch Changes

- Updated dependencies [d4dc001]
  - mcp-use@1.3.3-canary.3

## 0.5.3-canary.2

### Patch Changes

- Updated dependencies [9fc286c]
  - mcp-use@1.3.3-canary.2

## 0.5.3-canary.1

### Patch Changes

- mcp-use@1.3.3-canary.1

## 0.5.3-canary.0

### Patch Changes

- d4c246a: Add support for displaying console logs of widgets in the inspector preview panel
  - mcp-use@1.3.3-canary.0

## 0.5.2

### Patch Changes

- 835d367: - Updated the version of @modelcontextprotocol/sdk to 1.22.0 in both inspector and mcp-use package.json files.
- 835d367: Hanlde large json responses by showing a preview and a download button
- 835d367: chore: update dependencies
- Updated dependencies [835d367]
- Updated dependencies [835d367]
- Updated dependencies [835d367]
  - mcp-use@1.3.2

## 0.5.2-canary.5

### Patch Changes

- Updated dependencies [d9e3ae2]
  - mcp-use@1.3.2-canary.5

## 0.5.2-canary.4

### Patch Changes

- 9db6706: Hanlde large json responses by showing a preview and a download button
  - mcp-use@1.3.2-canary.4

## 0.5.2-canary.3

### Patch Changes

- mcp-use@1.3.2-canary.3

## 0.5.2-canary.2

### Patch Changes

- mcp-use@1.3.2-canary.2

## 0.5.2-canary.1

### Patch Changes

- mcp-use@1.3.2-canary.1

## 0.5.2-canary.0

### Patch Changes

- 2ebe233: - Updated the version of @modelcontextprotocol/sdk to 1.22.0 in both inspector and mcp-use package.json files.
- 2ebe233: chore: update dependencies
- Updated dependencies [2ebe233]
- Updated dependencies [2ebe233]
  - mcp-use@1.3.2-canary.0

## 0.5.1

### Patch Changes

- 91fdcee: - Updated the version of @modelcontextprotocol/sdk to 1.22.0 in both inspector and mcp-use package.json files.
- 91fdcee: chore: update dependencies
- Updated dependencies [91fdcee]
- Updated dependencies [91fdcee]
  - mcp-use@1.3.1

## 0.5.1-canary.0

### Patch Changes

- 9ece7fe: - Updated the version of @modelcontextprotocol/sdk to 1.22.0 in both inspector and mcp-use package.json files.
- 9ece7fe: chore: update dependencies
- Updated dependencies [9ece7fe]
- Updated dependencies [9ece7fe]
  - mcp-use@1.3.1-canary.0

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

- f25018a: Removed non functional setting button and removed tool input formatting that made it annoying to type arrays
- Updated dependencies [26e1162]
- Updated dependencies [26e1162]
  - mcp-use@1.3.0

## 0.5.0-canary.1

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
  - mcp-use@1.3.0-canary.1

## 0.5.0-canary.0

### Minor Changes

- 3db425d: Migrated mcp-use server from Express to Hono framework to enable edge runtime support (Cloudflare Workers, Deno Deploy, Supabase Edge Functions). Added runtime detection for Deno/Node.js environments, Connect middleware adapter for compatibility, and `getHandler()` method for edge deployment. Updated dependencies: added `hono` and `@hono/node-server`, moved `connect` and `node-mocks-http` to optional dependencies, removed `express` and `cors` from peer dependencies.

  Added Supabase deployment documentation and example templates to create-mcp-use-app for easier edge runtime deployment.

### Patch Changes

- f25018a: Removed non functional setting button and removed tool input formatting that made it annoying to type arrays
- Updated dependencies [3db425d]
  - mcp-use@1.3.0-canary.0

## 0.4.13

### Patch Changes

- 9209e99: fix: inspector dependencies
- Updated dependencies [9209e99]
- Updated dependencies [9209e99]
  - mcp-use@1.2.4

## 0.4.13-canary.1

### Patch Changes

- Updated dependencies [8194ad2]
  - mcp-use@1.2.4-canary.1

## 0.4.13-canary.0

### Patch Changes

- 8e2210a: fix: inspector dependencies
- Updated dependencies [8e2210a]
  - mcp-use@1.2.4-canary.0

## 0.4.12

### Patch Changes

- Updated dependencies [410c67c]
- Updated dependencies [410c67c]
  - mcp-use@1.2.3

## 0.4.12-canary.1

### Patch Changes

- Updated dependencies [7d0f904]
  - mcp-use@1.2.3-canary.1

## 0.4.12-canary.0

### Patch Changes

- Updated dependencies [d5ed5ba]
  - mcp-use@1.2.3-canary.0

## 0.4.11

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
  - mcp-use@1.2.2

## 0.4.11-canary.1

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
  - mcp-use@1.2.2-canary.1

## 0.4.11-canary.0

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
  - mcp-use@1.2.2-canary.0

## 0.4.10

### Patch Changes

- 9e555ef: fix: inspector deps
  - mcp-use@1.2.1

## 0.4.10-canary.0

### Patch Changes

- a5a6919: fix: inspector deps
  - mcp-use@1.2.1-canary.0

## 0.4.9

### Patch Changes

- 708cc5b: fix: enhance widget CSP handling and security headers
- 708cc5b: chore: update langchain dependencies
- 708cc5b: fix: apps sdk metadata setup from widget build
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
- Updated dependencies [708cc5b]
  - mcp-use@1.2.0

## 0.4.9-canary.7

### Patch Changes

- a8e5b65: fix: apps sdk metadata setup from widget build
- Updated dependencies [a8e5b65]
  - mcp-use@1.2.0-canary.6

## 0.4.9-canary.6

### Patch Changes

- Updated dependencies [940d727]
  - mcp-use@1.2.0-canary.5

## 0.4.9-canary.5

### Patch Changes

- b9b739b: chore: update langchain dependencies
  - mcp-use@1.2.0-canary.4

## 0.4.9-canary.4

### Patch Changes

- Updated dependencies [da6e7ed]
  - mcp-use@1.2.0-canary.3

## 0.4.9-canary.3

### Patch Changes

- Updated dependencies [3f2d2e9]
  - mcp-use@1.2.0-canary.2

## 0.4.9-canary.2

### Patch Changes

- Updated dependencies [5dd503f]
  - mcp-use@1.2.0-canary.1

## 0.4.9-canary.1

### Patch Changes

- 3b72cde: fix: enhance widget CSP handling and security headers

## 0.4.9-canary.0

### Patch Changes

- Updated dependencies [b24a213]
  - mcp-use@1.2.0-canary.0

## 0.4.8

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
  - mcp-use@1.1.8

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
