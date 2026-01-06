---
"@mcp-use/inspector": minor
"mcp-use": minor
"@mcp-use/cli": minor
---

feat: remove Node.js dependencies and improve browser compatibility

This release removes Node.js-specific dependencies and significantly improves browser compatibility across the mcp-use ecosystem.

## Breaking Changes

- **Logging**: Removed `winston` dependency. The logging system now uses a simple console logger that works in both browser and Node.js environments.

## New Features

### Browser Runtime Support

- **Browser Telemetry**: Added `telemetry-browser.ts` that uses `posthog-js` for browser environments, separate from Node.js telemetry
- **Browser Entry Point**: Enhanced `browser.ts` entry point with improved browser-specific utilities
- **Browser Utilities**: Added new utilities:
  - `utils/favicon-detector.ts` - Detect and extract favicons from URLs
  - `utils/proxy-config.ts` - Proxy configuration utilities for browser environments
  - `utils/mcpClientUtils.ts` - MCP client utilities moved from client package

### React Components

- **AddToClientDropdown**: New React component (`src/react/AddToClientDropdown.tsx`) for adding MCP servers to clients with enhanced UI and functionality

### Server Middleware

- **MCP Proxy Middleware**: Added `server/middleware/mcp-proxy.ts` - Hono middleware for proxying MCP server requests with optional authentication and request validation

### Inspector Improvements

- Enhanced inspector components for better browser compatibility
- Improved server icon support and component interactions
- Added embedded mode support
- Better configuration handling and MCP proxy integration

## Refactoring

- **Telemetry Split**: Separated telemetry into `telemetry-browser.ts` (browser) and `telemetry-node.ts` (Node.js) for better environment-specific implementations
- **Logging Refactor**: Replaced Winston with `SimpleConsoleLogger` that works across all environments
- **Build Configuration**: Updated `tsup.config.ts` to exclude Node.js-specific dependencies (`winston`, `posthog-node`) from browser builds
- **Package Dependencies**: Removed `winston` and related Node.js-only dependencies from `package.json`

## Testing

- Added comprehensive test (`browser-react-no-node-deps.test.ts`) to ensure `mcp-use/react` and `mcp-use/browser` do not import Node.js dependencies

This release makes mcp-use fully compatible with browser environments while maintaining backward compatibility with Node.js applications.
