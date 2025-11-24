---
"create-mcp-use-app": minor
"@mcp-use/inspector": minor
"mcp-use": minor
"@mcp-use/cli": minor
---

## New Features

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