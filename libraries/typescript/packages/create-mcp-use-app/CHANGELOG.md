# create-mcp-use-app

## 0.10.2

### Patch Changes

- bcdecd4: This release includes significant enhancements to OAuth flow handling, server metadata caching, and favicon detection:

  **OAuth Flow Enhancements**
  - Enhanced OAuth proxy to support gateway/proxy scenarios (e.g., Supabase MCP servers)
  - Added automatic metadata URL rewriting from gateway URLs to actual server URLs
  - Implemented resource parameter rewriting for authorize and token requests to use actual server URLs
  - Added WWW-Authenticate header discovery for OAuth metadata endpoints
  - Store and reuse OAuth proxy settings in callback flow for CORS bypass during token exchange
  - Added X-Forwarded-Host support for proper proxy URL construction in dev environments

  **Client Info Support**
  - Added `clientInfo` configuration prop to `McpClientProvider` for OAuth registration
  - Client info (name, version, icons, websiteUrl) is now sent during OAuth registration and displayed on consent pages
  - Supports per-server client info override
  - Inspector now includes client info with branding

  **Server Metadata Caching**
  - Added `CachedServerMetadata` interface for storing server name, version, icons, and other metadata
  - Extended `StorageProvider` interface with optional metadata methods (`getServerMetadata`, `setServerMetadata`, `removeServerMetadata`)
  - Implemented metadata caching in `LocalStorageProvider` and `MemoryStorageProvider`
  - Server metadata is now automatically cached when servers connect and used as initial display while fetching fresh data
  - Improves UX by showing server info immediately on reconnect

  **Inspector Improvements**
  - Added logging middleware to API routes for better debugging
  - Simplified server ID handling by removing redundant URL decoding (searchParams.get() already decodes)
  - Added X-Forwarded-Host header forwarding in Vite proxy configuration
  - Enabled OAuth proxy logging for better visibility

  **Favicon Detection Improvements**
  - Enhanced favicon detector to try all subdomain levels (e.g., mcp.supabase.com → supabase.com → com)
  - Added detection of default vs custom favicons using JSON API response
  - Prefer non-default favicons when available
  - Better handling of fallback cases

  **Other Changes**
  - Updated multi-server example with Supabase OAuth proxy example
  - Added connectionUrl parameter passing for resource field rewriting throughout OAuth flow
  - Improved logging and error messages throughout OAuth flow

- bcdecd4: fix: remove import from "mcp-use" which causes langchain import in server
- bcdecd4: feat(hmr): enhance synchronization for tools, prompts, and resources
  - Implemented a generic synchronization mechanism for hot module replacement (HMR) that updates tools, prompts, and resources in active sessions without removal.
  - Added support for detecting changes in definitions, including renames and updates, ensuring seamless integration during HMR.
  - Improved logging for changes in registrations, enhancing developer visibility into updates during the HMR process.
  - Introduced a new file for HMR synchronization logic, centralizing the handling of updates across different primitive types.

## 0.10.2-canary.2

### Patch Changes

- e962a16: fix: remove import from "mcp-use" which causes langchain import in server

## 0.10.2-canary.1

### Patch Changes

- 118cb30: feat(hmr): enhance synchronization for tools, prompts, and resources
  - Implemented a generic synchronization mechanism for hot module replacement (HMR) that updates tools, prompts, and resources in active sessions without removal.
  - Added support for detecting changes in definitions, including renames and updates, ensuring seamless integration during HMR.
  - Improved logging for changes in registrations, enhancing developer visibility into updates during the HMR process.
  - Introduced a new file for HMR synchronization logic, centralizing the handling of updates across different primitive types.

## 0.10.2-canary.0

### Patch Changes

- dfb30a6: This release includes significant enhancements to OAuth flow handling, server metadata caching, and favicon detection:

  **OAuth Flow Enhancements**
  - Enhanced OAuth proxy to support gateway/proxy scenarios (e.g., Supabase MCP servers)
  - Added automatic metadata URL rewriting from gateway URLs to actual server URLs
  - Implemented resource parameter rewriting for authorize and token requests to use actual server URLs
  - Added WWW-Authenticate header discovery for OAuth metadata endpoints
  - Store and reuse OAuth proxy settings in callback flow for CORS bypass during token exchange
  - Added X-Forwarded-Host support for proper proxy URL construction in dev environments

  **Client Info Support**
  - Added `clientInfo` configuration prop to `McpClientProvider` for OAuth registration
  - Client info (name, version, icons, websiteUrl) is now sent during OAuth registration and displayed on consent pages
  - Supports per-server client info override
  - Inspector now includes client info with branding

  **Server Metadata Caching**
  - Added `CachedServerMetadata` interface for storing server name, version, icons, and other metadata
  - Extended `StorageProvider` interface with optional metadata methods (`getServerMetadata`, `setServerMetadata`, `removeServerMetadata`)
  - Implemented metadata caching in `LocalStorageProvider` and `MemoryStorageProvider`
  - Server metadata is now automatically cached when servers connect and used as initial display while fetching fresh data
  - Improves UX by showing server info immediately on reconnect

  **Inspector Improvements**
  - Added logging middleware to API routes for better debugging
  - Simplified server ID handling by removing redundant URL decoding (searchParams.get() already decodes)
  - Added X-Forwarded-Host header forwarding in Vite proxy configuration
  - Enabled OAuth proxy logging for better visibility

  **Favicon Detection Improvements**
  - Enhanced favicon detector to try all subdomain levels (e.g., mcp.supabase.com → supabase.com → com)
  - Added detection of default vs custom favicons using JSON API response
  - Prefer non-default favicons when available
  - Better handling of fallback cases

  **Other Changes**
  - Updated multi-server example with Supabase OAuth proxy example
  - Added connectionUrl parameter passing for resource field rewriting throughout OAuth flow
  - Improved logging and error messages throughout OAuth flow

## 0.10.1

### Patch Changes

- 2f89a3b: Updated dependency `react-router` to `^7.12.0`.

## 0.10.1-canary.0

### Patch Changes

- 708f6e5: Updated dependency `react-router` to `^7.12.0`.

## 0.10.0

### Minor Changes

- e36d1ab: Add support for GitHub repository URLs in the `--template` option. Users can now initialize projects using any public GitHub repository as a template by providing the repository URL in formats like `owner/repo`, `https://github.com/owner/repo`, or `owner/repo#branch-name`.

### Patch Changes

- e36d1ab: fix: respect --template flag in interactive mode. Previously, when no project name was provided as a positional argument, the CLI would always prompt for template selection even if --template was explicitly provided via the command line flag. The tool now correctly uses the --template value when provided, only prompting for template selection when the flag is not specified.

## 0.10.0-canary.1

### Patch Changes

- 4531798: fix: respect --template flag in interactive mode. Previously, when no project name was provided as a positional argument, the CLI would always prompt for template selection even if --template was explicitly provided via the command line flag. The tool now correctly uses the --template value when provided, only prompting for template selection when the flag is not specified.

## 0.10.0-canary.0

### Minor Changes

- f6117d6: Add support for GitHub repository URLs in the `--template` option. Users can now initialize projects using any public GitHub repository as a template by providing the repository URL in formats like `owner/repo`, `https://github.com/owner/repo`, or `owner/repo#branch-name`.

## 0.9.4

### Patch Changes

- 53fb670: fix: include node types in dev deps

## 0.9.4-canary.0

### Patch Changes

- 33274d2: fix: include node types in dev deps

## 0.9.3

### Patch Changes

- 9a8cb3a: chore(docs): updated examples and docs to use preferred methods

## 0.9.3-canary.0

### Patch Changes

- 681c929: chore(docs): updated examples and docs to use preferred methods

## 0.9.2

### Patch Changes

- ae4ac11: chore: updated templates to use MCPServer instead of createMcpServer

## 0.9.1

### Patch Changes

- c225250: fix: add typescript to dev deps

## 0.9.1-canary.0

### Patch Changes

- bbf7159: fix: add typescript to dev deps

## 0.9.0

### Minor Changes

- 8a2e84e: ## Breaking Changes

  ### LangChain Adapter Export Path Changed

  The LangChain adapter is no longer exported from the main entry point. Import from `mcp-use/adapters` instead:

  ```typescript
  // Before
  import { LangChainAdapter } from "mcp-use";

  // After
  import { LangChainAdapter } from "mcp-use/adapters";
  ```

  **Note:** `@langchain/core` and `langchain` moved from dependencies to optional peer dependencies.

  **Learn more:** [LangChain Integration](/typescript/agent/llm-integration)

  ### WebSocket Transport Removed

  WebSocket transport support has been removed. Use streamable HTTP or SSE transports instead.

  **Learn more:** [Client Configuration](/typescript/client/client-configuration)

  ## Features

  ### Session Management Architecture with Redis Support

  Implements a pluggable session management architecture enabling distributed deployments with cross-server notifications, sampling, and resource subscriptions.

  **New Interfaces:**
  - `SessionStore` - Pluggable interface for storing session metadata
    - `InMemorySessionStore` (production default)
    - `FileSystemSessionStore` (dev mode default)
    - `RedisSessionStore` (distributed deployments)
  - `StreamManager` - Manages active SSE connections
    - `InMemoryStreamManager` (default)
    - `RedisStreamManager` (distributed via Redis Pub/Sub)

  **Server Configuration:**

  ```typescript
  // Development (default - FileSystemSessionStore for hot reload)
  const server = new MCPServer({
    name: "dev-server",
    version: "1.0.0",
  });

  // Production distributed (cross-server notifications)
  import { RedisSessionStore, RedisStreamManager } from "mcp-use/server";
  const server = new MCPServer({
    name: "prod-server",
    version: "1.0.0",
    sessionStore: new RedisSessionStore({ client: redis }),
    streamManager: new RedisStreamManager({
      client: redis,
      pubSubClient: pubSubRedis,
    }),
  });
  ```

  **Client Improvements:**
  - Auto-refresh tools/resources/prompts when receiving list change notifications
  - Manual refresh methods: `refreshTools()`, `refreshResources()`, `refreshPrompts()`, `refreshAll()`
  - Automatic 404 handling and re-initialization per MCP spec

  **Convenience Methods:**
  - `sendToolsListChanged()` - Notify clients when tools list changes
  - `sendResourcesListChanged()` - Notify clients when resources list changes
  - `sendPromptsListChanged()` - Notify clients when prompts list changes

  **Development Experience:**
  - FileSystemSessionStore persists sessions to `.mcp-use/sessions.json` in dev mode
  - Sessions survive server hot reloads
  - Auto-cleanup of expired sessions (>24 hours)

  **Deprecated:**
  - `autoCreateSessionOnInvalidId` - Now follows MCP spec strictly (returns 404 for invalid sessions)

  **Learn more:** [Session Management](/typescript/server/session-management)

  ### Favicon Support for Widgets

  Added favicon configuration for widget pages:

  ```typescript
  const server = createMCPServer({
    name: "my-server",
    version: "1.0.0",
    favicon: "favicon.ico", // Path relative to public/ directory
  });
  ```

  - Favicon automatically served at `/favicon.ico` for entire server domain
  - CLI build process includes favicon in widget HTML pages
  - Long-term caching (1 year) for favicon assets

  **Learn more:** [UI Widgets](/typescript/server/ui-widgets) and [Server Configuration](/typescript/server/configuration)

  ### CLI Client Support

  Added dedicated CLI client support for better command-line integration and testing.

  **Learn more:** [CLI Client](/typescript/client/cli)

  ### Enhanced Session Methods
  - `callTool()` method now defaults args to an empty object
  - New `requireSession()` method for reliable session retrieval

  ## Improvements

  ### Widget Build System
  - Automatic cleanup of stale widget directories in `.mcp-use` folder
  - Dev mode watches for widget file/directory deletions and cleans up build artifacts

  ### Dependency Management
  - Added support for Node >= 18
  - Added CommonJS module support

  ### Documentation & Metadata
  - Updated agent documentation and method signatures
  - Added repository metadata to package.json

  ## Fixes

  ### Widget Fixes
  - Fixed widget styling isolation - widgets no longer pick up mcp-use styles
  - Fixed favicon URL generator for proper asset resolution

  ### React Router Migration

  Migrated from `react-router-dom` to `react-router` for better compatibility and reduced bundle size.

  **Learn more:** [useMcp Hook](/typescript/client/usemcp)

  ### Session & Transport Fixes
  - Fixed transport cleanup when session becomes idle
  - Fixed agent access to resources and prompts

  ### Code Quality
  - Formatting and linting improvements across packages

### Patch Changes

- 8a2e84e: chore: moved dev deps from the workspace packages to the typescript root for consistency
- 8a2e84e: chore: fixed codeql vulnerabilities

## 0.8.1-canary.5

### Patch Changes

- a90ac6f: chore: fixed codeql vulnerabilities

## 0.8.1-canary.4

### Patch Changes

- 68d1520: chore: moved dev deps from the workspace packages to the typescript root for consistency

## 0.8.1-canary.3

### Patch Changes

- 14c015e: fix: trigger changeset

## 0.8.1-canary.2

### Patch Changes

- 3945a10: **Breaking Changes:**
  - LangChain adapter no longer exported from main entry point. Import from `mcp-use/adapters` instead:

    ```ts
    // Before
    import { LangChainAdapter } from "mcp-use";

    // After
    import { LangChainAdapter } from "mcp-use/adapters";
    ```

  - Moved `@langchain/core` and `langchain` from dependencies to optional peer dependencies

  **Features:**
  - Added favicon support for widget pages. Configure via `favicon` option in `ServerConfig`:
    ```ts
    const server = createMCPServer({
      name: "my-server",
      version: "1.0.0",
      favicon: "favicon.ico", // Path relative to public/ directory
    });
    ```
  - Favicon automatically served at `/favicon.ico` for entire server domain
  - CLI build process now includes favicon in widget HTML pages

  **Improvements:**
  - Automatic cleanup of stale widget directories in `.mcp-use` folder
  - Dev mode now watches for widget file/directory deletions and cleans up build artifacts
  - Added long-term caching (1 year) for favicon assets

- 3945a10: fix: widgets

## 0.8.1-canary.1

### Patch Changes

- 9acf03b: fix: drop react-router-dom in favor of react-router

## 0.8.1-canary.0

### Patch Changes

- 122a36c: Added repository metadata in package.json

## 0.8.0

### Minor Changes

- 6ec11cd: ## Breaking Changes
  - **Server API**: Renamed `createMCPServer()` factory function to `MCPServer` class constructor. The factory function is still available for backward compatibility but new code should use `new MCPServer({ name, ... })`.
  - **Session API**: Replaced `session.connector.tools`, `session.connector.callTool()`, etc. with direct methods: `session.tools`, `session.callTool()`, `session.listResources()`, `session.readResource()`, etc.
  - **OAuth Environment Variables**: Standardized OAuth env vars to `MCP_USE_OAUTH_*` prefix (e.g., `AUTH0_DOMAIN` → `MCP_USE_OAUTH_AUTH0_DOMAIN`).

  ## New Features
  - **Client Capabilities API**: Added `ctx.client.can()` and `ctx.client.capabilities()` to check client capabilities in tool callbacks.
  - **Session Notifications**: Added `ctx.sendNotification()` and `ctx.sendNotificationToSession()` for sending notifications from tool callbacks.
  - **Session Info**: Added `ctx.session.sessionId` to access current session ID in tool callbacks.
  - **Resource Template Flat Structure**: Resource templates now support flat structure with `uriTemplate` directly on definition (in addition to nested structure).
  - **Resource Template Callback Signatures**: Resource template callbacks now support multiple signatures: `()`, `(uri)`, `(uri, params)`, `(uri, params, ctx)`.
  - **Type Exports**: Added exports for `CallToolResult`, `Tool`, `ToolAnnotations`, `PromptResult`, `GetPromptResult` types.

  ## Improvements
  - **Type Inference**: Enhanced type inference for resource template callbacks with better overload support.
  - **Client Capabilities Tracking**: Server now captures and stores client capabilities during initialization.
  - **Session Methods**: Added convenience methods to `MCPSession` for all MCP operations (listResources, readResource, subscribeToResource, listPrompts, getPrompt, etc.).
  - **Documentation**: Major documentation refactoring and restructuring for better organization.

### Patch Changes

- 6ec11cd: fix: refactor to use https://github.com/modelcontextprotocol/typescript-sdk/pull/1209
- 6ec11cd: Updated dependencies.
- 6ec11cd: fix: fix transport bug
- 6ec11cd: chore: fix types

## 0.8.0-canary.2

### Patch Changes

- 1379b00: chore: fix types

## 0.8.0-canary.1

### Minor Changes

- 96e4097: ## Breaking Changes
  - **Server API**: Renamed `createMCPServer()` factory function to `MCPServer` class constructor. The factory function is still available for backward compatibility but new code should use `new MCPServer({ name, ... })`.
  - **Session API**: Replaced `session.connector.tools`, `session.connector.callTool()`, etc. with direct methods: `session.tools`, `session.callTool()`, `session.listResources()`, `session.readResource()`, etc.
  - **OAuth Environment Variables**: Standardized OAuth env vars to `MCP_USE_OAUTH_*` prefix (e.g., `AUTH0_DOMAIN` → `MCP_USE_OAUTH_AUTH0_DOMAIN`).

  ## New Features
  - **Client Capabilities API**: Added `ctx.client.can()` and `ctx.client.capabilities()` to check client capabilities in tool callbacks.
  - **Session Notifications**: Added `ctx.sendNotification()` and `ctx.sendNotificationToSession()` for sending notifications from tool callbacks.
  - **Session Info**: Added `ctx.session.sessionId` to access current session ID in tool callbacks.
  - **Resource Template Flat Structure**: Resource templates now support flat structure with `uriTemplate` directly on definition (in addition to nested structure).
  - **Resource Template Callback Signatures**: Resource template callbacks now support multiple signatures: `()`, `(uri)`, `(uri, params)`, `(uri, params, ctx)`.
  - **Type Exports**: Added exports for `CallToolResult`, `Tool`, `ToolAnnotations`, `PromptResult`, `GetPromptResult` types.

  ## Improvements
  - **Type Inference**: Enhanced type inference for resource template callbacks with better overload support.
  - **Client Capabilities Tracking**: Server now captures and stores client capabilities during initialization.
  - **Session Methods**: Added convenience methods to `MCPSession` for all MCP operations (listResources, readResource, subscribeToResource, listPrompts, getPrompt, etc.).
  - **Documentation**: Major documentation refactoring and restructuring for better organization.

## 0.7.5-canary.0

### Patch Changes

- 4d1aa19: fix: refactor to use https://github.com/modelcontextprotocol/typescript-sdk/pull/1209

## 0.7.4

### Patch Changes

- 4fc04a9: Updated dependencies.
- 4fc04a9: fix: fix transport bug

## 0.7.4-canary.1

### Patch Changes

- b0d1ffe: fix: fix transport bug

## 0.7.4-canary.0

### Patch Changes

- d726bfa: Updated dependencies.

## 0.7.3

### Patch Changes

- 4bf21f3: Updated dependencies.

## 0.7.3-canary.0

### Patch Changes

- 33a1a69: Updated dependencies.

## 0.7.2

### Patch Changes

- a4341d5: chore: update deps

## 0.7.2-canary.0

### Patch Changes

- c1d7378: chore: update deps

## 0.7.1

### Patch Changes

- 2730902: fix: parse port to number
- 2730902: Optimized dependencies
- 2730902: Moved ai sdk dep to optional since it's only used in test and example

## 0.7.1-canary.1

### Patch Changes

- caf8c7c: fix: parse port to number
- caf8c7c: Moved ai sdk dep to optional since it's only used in test and example

## 0.7.1-canary.0

### Patch Changes

- 1ca9801: Optimized dependencies

## 0.7.0

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
  - Added server inspection URL to Supabase deployment documentation (`docs/typescript/server/deployment/supabase.mdx`)

  ### Other Fixes
  - Fixed history management to prevent unwanted redirects when running widgets in inspector dev-widget proxy
  - Fixed macOS resource fork file exclusion in widget discovery (`.DS_Store`, `._*` files)
  - Fixed Vite HMR WebSocket connection by using direct dev server URLs instead of proxy
  - Fixed CSS imports in SSR mode by adding custom plugin to handle CSS files properly

- 7e4dd9b: Release canary

### Patch Changes

- 7e4dd9b: fix versions
- 7e4dd9b: - **Security**: Added `https://*.openai.com` to Content Security Policy trusted domains for widgets
  - **Type safety**: Exported `WidgetMetadata` type from `mcp-use/react` for better widget development experience
  - **Templates**: Updated widget templates to use `WidgetMetadata` type and fixed CSS import paths (moved styles to resources directory)
  - **Documentation**: Added comprehensive Apps SDK metadata documentation including CSP configuration examples
- 7e4dd9b: - Fix OpenAI Apps SDK UI theme synchronization by setting data-theme attribute and color-scheme on iframe document
  - Replace hardcoded Tailwind color classes with design tokens in create-mcp-use-app template components
  - Fix collapsed panel size from 5 to 6 in Prompts, Resources, and Tools tabs

## 0.6.1-canary.0

### Patch Changes

- 12a88c7: fix versions

## 0.6.0

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
  - Added server inspection URL to Supabase deployment documentation (`docs/typescript/server/deployment/supabase.mdx`)

  ### Other Fixes
  - Fixed history management to prevent unwanted redirects when running widgets in inspector dev-widget proxy
  - Fixed macOS resource fork file exclusion in widget discovery (`.DS_Store`, `._*` files)
  - Fixed Vite HMR WebSocket connection by using direct dev server URLs instead of proxy
  - Fixed CSS imports in SSR mode by adding custom plugin to handle CSS files properly

- 266a445: Release canary

## 0.6.0-canary.1

### Minor Changes

- 018395c: Release canary

## 0.6.0-canary.0

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
  - Added server inspection URL to Supabase deployment documentation (`docs/typescript/server/deployment/supabase.mdx`)

  ### Other Fixes
  - Fixed history management to prevent unwanted redirects when running widgets in inspector dev-widget proxy
  - Fixed macOS resource fork file exclusion in widget discovery (`.DS_Store`, `._*` files)
  - Fixed Vite HMR WebSocket connection by using direct dev server URLs instead of proxy
  - Fixed CSS imports in SSR mode by adding custom plugin to handle CSS files properly

## 0.5.2

### Patch Changes

- 33e4a68: Fix dev deps

## 0.5.2-canary.0

### Patch Changes

- d221493: Fix dev deps

## 0.5.1

### Patch Changes

- 835d367: add node types
- 835d367: make installation disabled by default and add deploy command to template package
- 835d367: fix templates deps

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
