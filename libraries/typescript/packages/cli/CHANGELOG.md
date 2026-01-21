# @mcp-use/cli

## 2.11.0-canary.13

### Patch Changes

- Updated dependencies [453661d]
  - @mcp-use/inspector@0.16.0-canary.13
  - mcp-use@1.14.0-canary.13

## 2.11.0-canary.12

### Patch Changes

- f428514: Fix displayPackageVersions() to work in standalone installations
  - Added optional projectPath parameter to resolve packages dynamically
  - Uses createRequire() to find packages in user's node_modules (standalone installation)
  - Falls back to relative paths for monorepo development
  - Added debug logging when packages aren't found (via DEBUG or VERBOSE env vars)
  - mcp-use@1.14.0-canary.12
  - @mcp-use/inspector@0.16.0-canary.12

## 2.11.0-canary.11

### Patch Changes

- Updated dependencies [805092b]
  - @mcp-use/inspector@0.16.0-canary.11
  - mcp-use@1.14.0-canary.11

## 2.11.0-canary.10

### Patch Changes

- 945d93d: ### Inspector Enhancements
  - **New**: Custom properties support for resources - `PropsSelect` component for dynamic prop configuration
  - **New**: `PropsConfigDialog` for managing resource properties with AI-powered suggestions
  - **New**: `SchemaFormField` for rendering JSON schema-based forms
  - **New**: `usePropsLLM` hook for AI-powered property suggestions
  - **New**: `useResourceProps` hook for managing resource props state
  - **Enhancement**: Enhanced `JSONDisplay` with improved line wrapping and font size for better readability
  - **Enhancement**: Collapsible description section in `ToolExecutionPanel`
  - **Enhancement**: Integrated JSON metadata visualization in tool execution panel
  - **Enhancement**: Enhanced `McpUIRenderer` and `OpenAIComponentRenderer` with `customProps` support
  - **Enhancement**: Updated `ResourceResultDisplay` with dynamic property configuration

  ### CLI Improvements
  - **New**: `MCP_URL` environment variable for server URL configuration

  ### MCP Proxy
  - **Enhancement**: Improved error logging with better context
  - **Enhancement**: Connection refused errors now logged as warnings
  - **Enhancement**: Error responses now include target URL for easier debugging

- Updated dependencies [945d93d]
  - @mcp-use/inspector@0.16.0-canary.10
  - mcp-use@1.14.0-canary.10

## 2.11.0-canary.9

### Patch Changes

- 782bb3e: feat(cli): enhance CLI to display package versions during dev and build commands
  - mcp-use@1.14.0-canary.9
  - @mcp-use/inspector@0.16.0-canary.9

## 2.11.0-canary.8

### Patch Changes

- Updated dependencies [e96063a]
  - mcp-use@1.14.0-canary.8
  - @mcp-use/inspector@0.16.0-canary.8

## 2.11.0-canary.7

### Patch Changes

- Updated dependencies [0cfeb1d]
- Updated dependencies [4652707]
  - mcp-use@1.14.0-canary.7
  - @mcp-use/inspector@0.16.0-canary.7

## 2.11.0-canary.6

### Patch Changes

- Updated dependencies [1fb5e5e]
- Updated dependencies [948e0ae]
  - mcp-use@1.14.0-canary.6
  - @mcp-use/inspector@0.16.0-canary.6

## 2.11.0-canary.5

### Patch Changes

- da4c861: refactor(cli): streamline widget building process with parallel execution
  - mcp-use@1.14.0-canary.5
  - @mcp-use/inspector@0.16.0-canary.5

## 2.11.0-canary.4

### Patch Changes

- Updated dependencies [3a94755]
  - mcp-use@1.14.0-canary.4
  - @mcp-use/inspector@0.16.0-canary.4

## 2.11.0-canary.3

### Minor Changes

- 3178200: ## Dependency Updates

  Updated 36 dependencies across all TypeScript packages to their latest compatible versions.

  ### Major Updates
  - **react-resizable-panels**: 3.0.6 → 4.4.1
    - Migrated to v4 API (`PanelGroup` → `Group`, `PanelResizeHandle` → `Separator`)
    - Updated `direction` prop to `orientation` across all inspector tabs
    - Maintained backward compatibility through wrapper component

  ### Minor & Patch Updates

  **Framework & Build Tools:**
  - @types/node: 25.0.2 → 25.0.9
  - @types/react: 19.2.7 → 19.2.8
  - @typescript-eslint/eslint-plugin: 8.49.0 → 8.53.1
  - @typescript-eslint/parser: 8.49.0 → 8.53.1
  - prettier: 3.7.4 → 3.8.0
  - typescript-eslint: 8.49.0 → 8.53.1
  - vite: 7.3.0 → 7.3.1
  - vitest: 4.0.15 → 4.0.17

  **Runtime Dependencies:**
  - @hono/node-server: 1.19.7 → 1.19.9
  - @langchain/anthropic: 1.3.0 → 1.3.10
  - @langchain/core: 1.1.12 → 1.1.15
  - @langchain/google-genai: 2.1.0 → 2.1.10
  - @langchain/openai: 1.2.0 → 1.2.2
  - @mcp-ui/client: 5.17.1 → 5.17.3
  - @mcp-ui/server: 5.16.2 → 5.16.3
  - posthog-js: 1.306.1 → 1.330.0
  - posthog-node: 5.17.2 → 5.22.0
  - ws: 8.18.3 → 8.19.0

  **UI Components:**
  - @eslint-react/eslint-plugin: 2.3.13 → 2.7.2
  - eslint-plugin-format: 1.1.0 → 1.3.1
  - eslint-plugin-react-refresh: 0.4.25 → 0.4.26
  - framer-motion: 12.23.26 → 12.27.1
  - motion: 12.23.26 → 12.27.1
  - markdown-to-jsx: 9.3.5 → 9.5.7
  - lucide-react: 0.561.0 → 0.562.0
  - vite-express: 0.21.1 → 0.22.0

  **Utilities:**
  - globby: 16.0.0 → 16.1.0
  - fs-extra: 11.3.2 → 11.3.3
  - ink: 6.5.1 → 6.6.0

  ### Removed
  - Removed `@ai-sdk/react` from inspector (unused, only in tests)
  - Removed `ai` from mcp-use dev dependencies (unused, only in tests/examples)

### Patch Changes

- Updated dependencies [3178200]
  - @mcp-use/inspector@0.16.0-canary.3
  - mcp-use@1.14.0-canary.3

## 2.11.0-canary.2

### Minor Changes

- ad66391: fix: improved HMR support for widgets

### Patch Changes

- Updated dependencies [ad66391]
  - @mcp-use/inspector@0.16.0-canary.2
  - mcp-use@1.14.0-canary.2

## 2.11.0-canary.1

### Patch Changes

- Updated dependencies [199199d]
  - @mcp-use/inspector@0.16.0-canary.1
  - mcp-use@1.14.0-canary.1

## 2.11.0-canary.0

### Minor Changes

- 53fdb48: feat: allow to set serverInfo (title, name, icons, websiteUrl, description), and updated templates to have defaults

### Patch Changes

- Updated dependencies [53fdb48]
  - @mcp-use/inspector@0.16.0-canary.0
  - mcp-use@1.14.0-canary.0

## 2.10.3

### Patch Changes

- b65d05d: feat(cli): add .gitignore and CLAUDE.md for CLI documentation
- Updated dependencies [b65d05d]
  - mcp-use@1.13.5
  - @mcp-use/inspector@0.15.3

## 2.10.3-canary.0

### Patch Changes

- de5f030: feat(cli): add .gitignore and CLAUDE.md for CLI documentation
  - mcp-use@1.13.5-canary.0
  - @mcp-use/inspector@0.15.3-canary.0

## 2.10.2

### Patch Changes

- Updated dependencies [dd8d07d]
  - mcp-use@1.13.4
  - @mcp-use/inspector@0.15.2

## 2.10.2-canary.0

### Patch Changes

- Updated dependencies [5c65df2]
  - mcp-use@1.13.4-canary.0
  - @mcp-use/inspector@0.15.2-canary.0

## 2.10.1

### Patch Changes

- Updated dependencies [294d17d]
- Updated dependencies [294d17d]
- Updated dependencies [294d17d]
  - @mcp-use/inspector@0.15.1
  - mcp-use@1.13.3

## 2.10.1-canary.2

### Patch Changes

- Updated dependencies [b06fa78]
  - @mcp-use/inspector@0.15.1-canary.2
  - mcp-use@1.13.3-canary.2

## 2.10.1-canary.1

### Patch Changes

- Updated dependencies [c3f2ebf]
  - @mcp-use/inspector@0.15.1-canary.1
  - mcp-use@1.13.3-canary.1

## 2.10.1-canary.0

### Patch Changes

- Updated dependencies [d446ee5]
  - @mcp-use/inspector@0.15.1-canary.0
  - mcp-use@1.13.3-canary.0

## 2.10.0

### Minor Changes

- 0144a31: feat(cli): enhance login and deployment commands
  - Updated the login command to handle errors gracefully
  - Modified the deployment command to prompt users for login if not authenticated
  - Removed the `fromSource` option from the deployment command
  - Added checks for uncommitted changes in the git repository before deployment
  - Updated various commands to consistently use `npx mcp-use login` for login instructions

  refactor(inspector, multi-server-example): authentication UI and logic
  - Simplified the authentication button logic in InspectorDashboard
  - Updated the multi-server example to directly link to the authentication URL

### Patch Changes

- Updated dependencies [0144a31]
- Updated dependencies [0144a31]
- Updated dependencies [0144a31]
- Updated dependencies [0144a31]
  - @mcp-use/inspector@0.15.0
  - mcp-use@1.13.2

## 2.10.0-canary.1

### Patch Changes

- Updated dependencies [7b137c2]
  - mcp-use@1.13.2-canary.1
  - @mcp-use/inspector@0.15.0-canary.1

## 2.10.0-canary.0

### Minor Changes

- 450ab65: feat(cli): enhance login and deployment commands
  - Updated the login command to handle errors gracefully
  - Modified the deployment command to prompt users for login if not authenticated
  - Removed the `fromSource` option from the deployment command
  - Added checks for uncommitted changes in the git repository before deployment
  - Updated various commands to consistently use `npx mcp-use login` for login instructions

  refactor(inspector, multi-server-example): authentication UI and logic
  - Simplified the authentication button logic in InspectorDashboard
  - Updated the multi-server example to directly link to the authentication URL

### Patch Changes

- Updated dependencies [52be97c]
- Updated dependencies [c9bde52]
- Updated dependencies [450ab65]
  - @mcp-use/inspector@0.15.0-canary.0
  - mcp-use@1.13.2-canary.0

## 2.9.1

### Patch Changes

- b8626dc: chore: update mcp-use version
- Updated dependencies [b8626dc]
- Updated dependencies [b8626dc]
  - mcp-use@1.13.1
  - @mcp-use/inspector@0.14.6

## 2.9.1-canary.1

### Patch Changes

- 727df09: chore: update mcp-use version
- Updated dependencies [727df09]
  - @mcp-use/inspector@0.14.6-canary.1
  - mcp-use@1.13.1-canary.1

## 2.9.1-canary.0

### Patch Changes

- Updated dependencies [548206f]
  - mcp-use@1.13.1-canary.0
  - @mcp-use/inspector@0.14.6-canary.0

## 2.9.0

### Minor Changes

- bcdecd4: feat: Hot Module Reloading (HMR) for MCP server development

  Added HMR support to the `mcp-use dev` command. When you modify your server file (add/remove/update tools, prompts, or resources), changes are applied instantly without restarting the server or dropping client connections.

  **Features:**
  - Tools, prompts, and resources can be added, removed, or updated on-the-fly
  - Connected clients (like the inspector) receive `list_changed` notifications and auto-refresh
  - No changes required to user code - existing server files work as-is
  - Syntax errors during reload are caught gracefully without crashing the server

  **How it works:**
  - CLI uses `chokidar` to watch `src/` directory and root `.ts`/`.tsx` files
  - On file change, the module is re-imported with cache-busting
  - `syncRegistrationsFrom()` diffs registrations and uses the SDK's native `RegisteredTool.update()` and `remove()` methods
  - `list_changed` notifications are sent to all connected sessions

  **Usage:**

  ```bash
  mcp-use dev  # HMR enabled by default
  mcp-use dev --no-hmr  # Disable HMR, use tsx watch instead
  ```

- bcdecd4: feat(cli): enhance hot module reloading and server management
  - Improved hot module reloading (HMR) support by allowing local `tsx` usage, falling back to `npx` if not found
  - Updated server command execution to handle TypeScript imports more effectively
  - Enhanced file watching capabilities to include `.ts` and `.tsx` files while ignoring unnecessary patterns
  - Streamlined tool, prompt, and resource registration during HMR to directly inject into active sessions without removal, preserving existing configurations
  - Added detailed logging for file changes and watcher readiness to improve developer experience

### Patch Changes

- bcdecd4: Add comprehensive test suite for Hot Module Replacement (HMR) functionality

  **Testing Approach:**

  Tests use minimal mocking, focusing on:
  - Real `MCPServer` instances
  - Actual console logs (the developer experience)
  - Direct registration state inspection
  - Light session mocking only for injection tests

  This approach is more robust and less brittle than heavy mocking, as tests verify real behavior and won't break when SDK internals change.

  **Test Coverage:**

  **Unit Tests** (`tests/unit/server/hmr.test.ts` - 15 tests):
  - Tool registration (add, update, inject)
  - Prompt registration (add, inject)
  - Resource registration (add, inject)
  - Notification sending (tools/list_changed, prompts/list_changed, resources/list_changed)
  - Entry methods (enable, disable, remove, update)
  - Error handling for injection failures
  - Graceful notification error handling

  **Integration Tests** (`tests/integration/hmr-cli.test.ts`):
  - End-to-end file change detection
  - Tool addition via HMR
  - Tool description updates
  - Syntax error handling and recovery
  - Connection persistence during HMR

  **CLI Tests** (`packages/cli/tests/tsx-resolution.test.ts`):
  - tsx binary resolution from package.json bin field
  - Handling string and object bin formats
  - Graceful error handling for missing bin field
  - Preference for 'tsx' entry in object form

  All tests include proper setup/teardown, mocking, and comprehensive assertions.

- bcdecd4: fix: remove import from "mcp-use" which causes langchain import in server
- bcdecd4: feat(hmr): enhance synchronization for tools, prompts, and resources
  - Implemented a generic synchronization mechanism for hot module replacement (HMR) that updates tools, prompts, and resources in active sessions without removal.
  - Added support for detecting changes in definitions, including renames and updates, ensuring seamless integration during HMR.
  - Improved logging for changes in registrations, enhancing developer visibility into updates during the HMR process.
  - Introduced a new file for HMR synchronization logic, centralizing the handling of updates across different primitive types.

- Updated dependencies [bcdecd4]
- Updated dependencies [bcdecd4]
- Updated dependencies [bcdecd4]
- Updated dependencies [bcdecd4]
- Updated dependencies [bcdecd4]
  - mcp-use@1.13.0
  - @mcp-use/inspector@0.14.5

## 2.9.0-canary.3

### Patch Changes

- e962a16: fix: remove import from "mcp-use" which causes langchain import in server
- Updated dependencies [e962a16]
  - @mcp-use/inspector@0.14.5-canary.3
  - mcp-use@1.13.0-canary.3

## 2.9.0-canary.2

### Patch Changes

- 118cb30: feat(hmr): enhance synchronization for tools, prompts, and resources
  - Implemented a generic synchronization mechanism for hot module replacement (HMR) that updates tools, prompts, and resources in active sessions without removal.
  - Added support for detecting changes in definitions, including renames and updates, ensuring seamless integration during HMR.
  - Improved logging for changes in registrations, enhancing developer visibility into updates during the HMR process.
  - Introduced a new file for HMR synchronization logic, centralizing the handling of updates across different primitive types.

- Updated dependencies [118cb30]
  - @mcp-use/inspector@0.14.5-canary.2
  - mcp-use@1.13.0-canary.2

## 2.9.0-canary.1

### Minor Changes

- 7359d66: feat(cli): enhance hot module reloading and server management
  - Improved hot module reloading (HMR) support by allowing local `tsx` usage, falling back to `npx` if not found
  - Updated server command execution to handle TypeScript imports more effectively
  - Enhanced file watching capabilities to include `.ts` and `.tsx` files while ignoring unnecessary patterns
  - Streamlined tool, prompt, and resource registration during HMR to directly inject into active sessions without removal, preserving existing configurations
  - Added detailed logging for file changes and watcher readiness to improve developer experience

### Patch Changes

- 7359d66: Add comprehensive test suite for Hot Module Replacement (HMR) functionality

  **Testing Approach:**

  Tests use minimal mocking, focusing on:
  - Real `MCPServer` instances
  - Actual console logs (the developer experience)
  - Direct registration state inspection
  - Light session mocking only for injection tests

  This approach is more robust and less brittle than heavy mocking, as tests verify real behavior and won't break when SDK internals change.

  **Test Coverage:**

  **Unit Tests** (`tests/unit/server/hmr.test.ts` - 15 tests):
  - Tool registration (add, update, inject)
  - Prompt registration (add, inject)
  - Resource registration (add, inject)
  - Notification sending (tools/list_changed, prompts/list_changed, resources/list_changed)
  - Entry methods (enable, disable, remove, update)
  - Error handling for injection failures
  - Graceful notification error handling

  **Integration Tests** (`tests/integration/hmr-cli.test.ts`):
  - End-to-end file change detection
  - Tool addition via HMR
  - Tool description updates
  - Syntax error handling and recovery
  - Connection persistence during HMR

  **CLI Tests** (`packages/cli/tests/tsx-resolution.test.ts`):
  - tsx binary resolution from package.json bin field
  - Handling string and object bin formats
  - Graceful error handling for missing bin field
  - Preference for 'tsx' entry in object form

  All tests include proper setup/teardown, mocking, and comprehensive assertions.

- Updated dependencies [7359d66]
  - mcp-use@1.13.0-canary.1
  - @mcp-use/inspector@0.14.5-canary.1

## 2.9.0-canary.0

### Minor Changes

- 0be9ed8: feat: Hot Module Reloading (HMR) for MCP server development

  Added HMR support to the `mcp-use dev` command. When you modify your server file (add/remove/update tools, prompts, or resources), changes are applied instantly without restarting the server or dropping client connections.

  **Features:**
  - Tools, prompts, and resources can be added, removed, or updated on-the-fly
  - Connected clients (like the inspector) receive `list_changed` notifications and auto-refresh
  - No changes required to user code - existing server files work as-is
  - Syntax errors during reload are caught gracefully without crashing the server

  **How it works:**
  - CLI uses `chokidar` to watch `src/` directory and root `.ts`/`.tsx` files
  - On file change, the module is re-imported with cache-busting
  - `syncRegistrationsFrom()` diffs registrations and uses the SDK's native `RegisteredTool.update()` and `remove()` methods
  - `list_changed` notifications are sent to all connected sessions

  **Usage:**

  ```bash
  mcp-use dev  # HMR enabled by default
  mcp-use dev --no-hmr  # Disable HMR, use tsx watch instead
  ```

### Patch Changes

- Updated dependencies [dfb30a6]
- Updated dependencies [0be9ed8]
  - @mcp-use/inspector@0.14.5-canary.0
  - mcp-use@1.13.0-canary.0

## 2.8.4

### Patch Changes

- Updated dependencies [5161914]
  - @mcp-use/inspector@0.14.4
  - mcp-use@1.12.4

## 2.8.4-canary.0

### Patch Changes

- Updated dependencies [a308b3f]
  - @mcp-use/inspector@0.14.4-canary.0
  - mcp-use@1.12.4-canary.0

## 2.8.3

### Patch Changes

- 2f89a3b: Security: Fixed 13 vulnerabilities (3 moderate, 10 high)
  - Updated `langchain` to `^1.2.3` (fixes serialization injection vulnerability)
  - Updated `@langchain/core` to `^1.1.8` (fixes serialization injection vulnerability)
  - Updated `react-router` to `^7.12.0` (fixes XSS and CSRF vulnerabilities)
  - Updated `react-router-dom` to `^7.12.0` (fixes XSS and CSRF vulnerabilities)
  - Added override for `qs` to `>=6.14.1` (fixes DoS vulnerability)
  - Added override for `preact` to `>=10.28.2` (fixes JSON VNode injection)

- Updated dependencies [2f89a3b]
- Updated dependencies [2f89a3b]
- Updated dependencies [2f89a3b]
  - @mcp-use/inspector@0.14.3
  - mcp-use@1.12.3

## 2.8.3-canary.1

### Patch Changes

- 9cdc757: Security: Fixed 13 vulnerabilities (3 moderate, 10 high)
  - Updated `langchain` to `^1.2.3` (fixes serialization injection vulnerability)
  - Updated `@langchain/core` to `^1.1.8` (fixes serialization injection vulnerability)
  - Updated `react-router` to `^7.12.0` (fixes XSS and CSRF vulnerabilities)
  - Updated `react-router-dom` to `^7.12.0` (fixes XSS and CSRF vulnerabilities)
  - Added override for `qs` to `>=6.14.1` (fixes DoS vulnerability)
  - Added override for `preact` to `>=10.28.2` (fixes JSON VNode injection)

- Updated dependencies [9cdc757]
- Updated dependencies [cbf2bb8]
  - mcp-use@1.12.3-canary.1
  - @mcp-use/inspector@0.14.3-canary.1

## 2.8.3-canary.0

### Patch Changes

- Updated dependencies [708f6e5]
  - @mcp-use/inspector@0.14.3-canary.0
  - mcp-use@1.12.3-canary.0

## 2.8.2

### Patch Changes

- 198fffd: Add configurable clientInfo support for MCP connection initialization. Clients can now customize how they identify themselves to MCP servers with full metadata including name, title, version, description, icons, and website URL. The clientConfig option is deprecated in favor of deriving it from clientInfo. Default clientInfo is set for mcp-use, inspector sets "mcp-use Inspector" with its own version, and CLI sets "mcp-use CLI".
- 198fffd: chore: updated docs
- 198fffd: ## Breaking Changes (with Deprecation Warnings)
  - **Renamed `customHeaders` to `headers`**: The `customHeaders` option has been renamed to `headers` across all APIs for better consistency. The old name still works but shows deprecation warnings. Update your code to use `headers` instead.
  - **Renamed `samplingCallback` to `onSampling`**: Callback naming is now more consistent with event handler patterns. The old name still works but shows deprecation warnings.

  ## New Features
  - **Automatic Proxy Fallback**: Added `autoProxyFallback` option to `useMcp` hook and `McpClientProvider`. When enabled (default: `true` in provider), automatically retries failed connections through a proxy when CORS errors or HTTP 4xx errors are detected. This makes connecting to MCP servers much more reliable in browser environments.
  - **Provider-Level Proxy Defaults**: `McpClientProvider` now supports `defaultProxyConfig` and `defaultAutoProxyFallback` props to set proxy configuration for all servers. Individual servers can override these defaults.
  - **OAuth Proxy Support**: Added OAuth request proxying through fetch interceptor in `BrowserOAuthClientProvider`. Configure with `oauthProxyUrl` to route OAuth discovery and token requests through your backend proxy.

  ## Improvements
  - **Enhanced Error Detection**: Better detection of OAuth discovery failures, CORS errors, and connection issues
  - **Smarter Connection Logic**: OAuth provider now always uses the original target URL for OAuth discovery, not the proxy URL
  - **Better Session Management**: Improved session cleanup to avoid noisy warning logs
  - **Type Safety**: Added deprecation notices in TypeScript types for deprecated options
  - **Proxy Header Support**: `proxyConfig` now accepts a `headers` field for custom headers to the proxy

  ## Refactoring
  - **Removed `oauth-helper.ts`** (521 lines): OAuth helper utilities consolidated into `browser-provider.ts`
  - **Removed `react_example.html`**: Outdated example file removed
  - **Major `useMcp` Hook Refactor**: Complete rewrite of connection logic with automatic retry, better error handling, and proxy fallback support

  ## Documentation
  - Updated all client documentation to use new `headers` naming
  - Added comprehensive examples for automatic proxy fallback
  - Updated sampling documentation with new `onSampling` callback name
  - Refreshed React integration guide with provider-based approach

- Updated dependencies [198fffd]
- Updated dependencies [198fffd]
- Updated dependencies [198fffd]
- Updated dependencies [198fffd]
- Updated dependencies [198fffd]
  - @mcp-use/inspector@0.14.2
  - mcp-use@1.12.2

## 2.8.2-canary.2

### Patch Changes

- f9b1001: chore: updated docs
- Updated dependencies [f9b1001]
  - @mcp-use/inspector@0.14.2-canary.2
  - mcp-use@1.12.2-canary.2

## 2.8.2-canary.1

### Patch Changes

- 94e4e63: Add configurable clientInfo support for MCP connection initialization. Clients can now customize how they identify themselves to MCP servers with full metadata including name, title, version, description, icons, and website URL. The clientConfig option is deprecated in favor of deriving it from clientInfo. Default clientInfo is set for mcp-use, inspector sets "mcp-use Inspector" with its own version, and CLI sets "mcp-use CLI".
- 94e4e63: ## Breaking Changes (with Deprecation Warnings)
  - **Renamed `customHeaders` to `headers`**: The `customHeaders` option has been renamed to `headers` across all APIs for better consistency. The old name still works but shows deprecation warnings. Update your code to use `headers` instead.
  - **Renamed `samplingCallback` to `onSampling`**: Callback naming is now more consistent with event handler patterns. The old name still works but shows deprecation warnings.

  ## New Features
  - **Automatic Proxy Fallback**: Added `autoProxyFallback` option to `useMcp` hook and `McpClientProvider`. When enabled (default: `true` in provider), automatically retries failed connections through a proxy when CORS errors or HTTP 4xx errors are detected. This makes connecting to MCP servers much more reliable in browser environments.
  - **Provider-Level Proxy Defaults**: `McpClientProvider` now supports `defaultProxyConfig` and `defaultAutoProxyFallback` props to set proxy configuration for all servers. Individual servers can override these defaults.
  - **OAuth Proxy Support**: Added OAuth request proxying through fetch interceptor in `BrowserOAuthClientProvider`. Configure with `oauthProxyUrl` to route OAuth discovery and token requests through your backend proxy.

  ## Improvements
  - **Enhanced Error Detection**: Better detection of OAuth discovery failures, CORS errors, and connection issues
  - **Smarter Connection Logic**: OAuth provider now always uses the original target URL for OAuth discovery, not the proxy URL
  - **Better Session Management**: Improved session cleanup to avoid noisy warning logs
  - **Type Safety**: Added deprecation notices in TypeScript types for deprecated options
  - **Proxy Header Support**: `proxyConfig` now accepts a `headers` field for custom headers to the proxy

  ## Refactoring
  - **Removed `oauth-helper.ts`** (521 lines): OAuth helper utilities consolidated into `browser-provider.ts`
  - **Removed `react_example.html`**: Outdated example file removed
  - **Major `useMcp` Hook Refactor**: Complete rewrite of connection logic with automatic retry, better error handling, and proxy fallback support

  ## Documentation
  - Updated all client documentation to use new `headers` naming
  - Added comprehensive examples for automatic proxy fallback
  - Updated sampling documentation with new `onSampling` callback name
  - Refreshed React integration guide with provider-based approach

- Updated dependencies [94e4e63]
- Updated dependencies [94e4e63]
- Updated dependencies [94e4e63]
  - @mcp-use/inspector@0.14.2-canary.1
  - mcp-use@1.12.2-canary.1

## 2.8.2-canary.0

### Patch Changes

- Updated dependencies [a0aa464]
  - @mcp-use/inspector@0.14.2-canary.0
  - mcp-use@1.12.2-canary.0

## 2.8.1

### Patch Changes

- e36d1ab: fix: directory separator on Windows platform causing widgets build fail. Normalize Windows backslash path separators to forward slashes when building widget entry paths to ensure cross-platform compatibility.
- Updated dependencies [e36d1ab]
- Updated dependencies [e36d1ab]
- Updated dependencies [e36d1ab]
  - @mcp-use/inspector@0.14.1
  - mcp-use@1.12.1

## 2.8.1-canary.2

### Patch Changes

- Updated dependencies [74ff401]
  - @mcp-use/inspector@0.14.1-canary.2
  - mcp-use@1.12.1-canary.2

## 2.8.1-canary.1

### Patch Changes

- 4ff190a: fix: directory separator on Windows platform causing widgets build fail. Normalize Windows backslash path separators to forward slashes when building widget entry paths to ensure cross-platform compatibility.
  - mcp-use@1.12.1-canary.1
  - @mcp-use/inspector@0.14.1-canary.1

## 2.8.1-canary.0

### Patch Changes

- Updated dependencies [1674a02]
- Updated dependencies [1674a02]
  - @mcp-use/inspector@0.14.1-canary.0
  - mcp-use@1.12.1-canary.0

## 2.8.0

### Minor Changes

- 53fb670: ## Multi-Server Support and Architecture Improvements

  ### Features
  - **Multi-server management**: Introduced `McpClientProvider` to manage multiple MCP server connections, allowing dynamic addition and removal of servers in React applications
  - **Storage providers**: Added pluggable storage system with `LocalStorageProvider` and `MemoryStorageProvider` for flexible server configuration persistence
  - **Enhanced RPC logging**: New `rpc-logger` module with filtering capabilities to reduce noisy endpoint logging (telemetry, RPC streams)
  - **Browser support**: Exported `MCPAgent` for browser usage with `BrowserMCPClient` instance or through `RemoteAgent`

  ### Inspector Enhancements
  - **Improved UI responsiveness**: Enhanced mobile and tablet layouts with adaptive component visibility
  - **Better server management**: Refactored server connection handling with improved icon display and status tracking
  - **Enhanced debugging**: Added detailed logging in Layout and useAutoConnect components for better monitoring of server connection states
  - **Simplified connection settings**: Removed deprecated transport types for cleaner configuration

  ### Architecture Changes
  - Removed obsolete `McpContext` (replaced with `McpClientProvider`)
  - Refactored `useMcp` hook for better multi-server support
  - Updated components across inspector for cleaner architecture and imports
  - Added multi-server React example demonstrating new capabilities

  ### Bug Fixes
  - Fixed server connection retrieval in `OpenAIComponentRenderer` to directly access connections array

- 53fb670: chore: make broser bundle node js free
- 53fb670: feat: remove Node.js dependencies and improve browser compatibility

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

### Patch Changes

- 53fb670: ci: add dev command testing to CI workflow & fix issue [#742](https://github.com/mcp-use/mcp-use/issues/742)
- 53fb670: chore: lint & format
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
- Updated dependencies [53fb670]
  - @mcp-use/inspector@0.14.0
  - mcp-use@1.12.0

## 2.8.0-canary.14

### Patch Changes

- Updated dependencies [b16431b]
  - @mcp-use/inspector@0.14.0-canary.14
  - mcp-use@1.12.0-canary.14

## 2.8.0-canary.13

### Patch Changes

- a95e8bb: ci: add dev command testing to CI workflow & fix issue [#742](https://github.com/mcp-use/mcp-use/issues/742)
  - mcp-use@1.12.0-canary.13
  - @mcp-use/inspector@0.14.0-canary.13

## 2.8.0-canary.12

### Patch Changes

- Updated dependencies [d02b8df]
  - mcp-use@1.12.0-canary.12
  - @mcp-use/inspector@0.14.0-canary.12

## 2.8.0-canary.11

### Patch Changes

- Updated dependencies [55db23e]
  - @mcp-use/inspector@0.14.0-canary.11
  - mcp-use@1.12.0-canary.11

## 2.8.0-canary.10

### Patch Changes

- ce4647d: chore: lint & format
- Updated dependencies [ce4647d]
  - @mcp-use/inspector@0.14.0-canary.10
  - mcp-use@1.12.0-canary.10

## 2.8.0-canary.9

### Patch Changes

- Updated dependencies [4fb8223]
  - mcp-use@1.12.0-canary.9
  - @mcp-use/inspector@0.14.0-canary.9

## 2.8.0-canary.8

### Patch Changes

- Updated dependencies [daf3c81]
  - mcp-use@1.12.0-canary.8
  - @mcp-use/inspector@0.14.0-canary.8

## 2.8.0-canary.7

### Patch Changes

- Updated dependencies [4f93dc3]
  - mcp-use@1.12.0-canary.7
  - @mcp-use/inspector@0.14.0-canary.7

## 2.8.0-canary.6

### Patch Changes

- Updated dependencies [2113c43]
  - @mcp-use/inspector@0.14.0-canary.6
  - mcp-use@1.12.0-canary.6

## 2.8.0-canary.5

### Patch Changes

- Updated dependencies [7381ec3]
  - @mcp-use/inspector@0.14.0-canary.5
  - mcp-use@1.12.0-canary.5

## 2.8.0-canary.4

### Patch Changes

- Updated dependencies [ef5a71d]
  - @mcp-use/inspector@0.14.0-canary.4
  - mcp-use@1.12.0-canary.4

## 2.8.0-canary.3

### Minor Changes

- 8bc7f4d: ## Multi-Server Support and Architecture Improvements

  ### Features
  - **Multi-server management**: Introduced `McpClientProvider` to manage multiple MCP server connections, allowing dynamic addition and removal of servers in React applications
  - **Storage providers**: Added pluggable storage system with `LocalStorageProvider` and `MemoryStorageProvider` for flexible server configuration persistence
  - **Enhanced RPC logging**: New `rpc-logger` module with filtering capabilities to reduce noisy endpoint logging (telemetry, RPC streams)
  - **Browser support**: Exported `MCPAgent` for browser usage with `BrowserMCPClient` instance or through `RemoteAgent`

  ### Inspector Enhancements
  - **Improved UI responsiveness**: Enhanced mobile and tablet layouts with adaptive component visibility
  - **Better server management**: Refactored server connection handling with improved icon display and status tracking
  - **Enhanced debugging**: Added detailed logging in Layout and useAutoConnect components for better monitoring of server connection states
  - **Simplified connection settings**: Removed deprecated transport types for cleaner configuration

  ### Architecture Changes
  - Removed obsolete `McpContext` (replaced with `McpClientProvider`)
  - Refactored `useMcp` hook for better multi-server support
  - Updated components across inspector for cleaner architecture and imports
  - Added multi-server React example demonstrating new capabilities

  ### Bug Fixes
  - Fixed server connection retrieval in `OpenAIComponentRenderer` to directly access connections array

### Patch Changes

- Updated dependencies [8bc7f4d]
  - @mcp-use/inspector@0.14.0-canary.3
  - mcp-use@1.12.0-canary.3

## 2.8.0-canary.2

### Patch Changes

- Updated dependencies [93fd156]
  - @mcp-use/inspector@0.14.0-canary.2
  - mcp-use@1.12.0-canary.2

## 2.8.0-canary.1

### Minor Changes

- 2156916: chore: make broser bundle node js free
- 2156916: feat: remove Node.js dependencies and improve browser compatibility

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

### Patch Changes

- Updated dependencies [2156916]
- Updated dependencies [2156916]
  - @mcp-use/inspector@0.14.0-canary.1
  - mcp-use@1.12.0-canary.1

## 2.7.1-canary.0

### Patch Changes

- Updated dependencies [841cccf]
  - @mcp-use/inspector@0.14.0-canary.0
  - mcp-use@1.11.3-canary.0

## 2.7.0

### Minor Changes

- 9a8cb3a: feat: added deployments management to the cli
- 9a8cb3a: feat: added support for project linking in cli
- 9a8cb3a: feat(cli): allow setting env vars for the deployment while deploying

### Patch Changes

- 9a8cb3a: fix(cli): port detection
- 9a8cb3a: chore(docs): updated examples and docs to use preferred methods
- Updated dependencies [9a8cb3a]
  - @mcp-use/inspector@0.13.2
  - mcp-use@1.11.2

## 2.7.0-canary.1

### Patch Changes

- 681c929: fix(cli): port detection
- 681c929: chore(docs): updated examples and docs to use preferred methods
- Updated dependencies [681c929]
  - @mcp-use/inspector@0.13.2-canary.1
  - mcp-use@1.11.2-canary.1

## 2.7.0-canary.0

### Minor Changes

- 0f3550c: feat: added deployments management to the cli
- 0f3550c: feat: added support for project linking in cli
- 0f3550c: feat(cli): allow setting env vars for the deployment while deploying

### Patch Changes

- mcp-use@1.11.2-canary.0
- @mcp-use/inspector@0.13.2-canary.0

## 2.6.1

### Patch Changes

- abf0e0f: fix: widget props not picked up if zod
- Updated dependencies [abf0e0f]
  - @mcp-use/inspector@0.13.1
  - mcp-use@1.11.1

## 2.6.1-canary.0

### Patch Changes

- 6fc856c: fix: widget props not picked up if zod
- Updated dependencies [6fc856c]
  - @mcp-use/inspector@0.13.1-canary.0
  - mcp-use@1.11.1-canary.0

## 2.6.0

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

- 8a2e84e: fix: import from mcp-use/client instead of main entry to avoid mixing dependencies
- 8a2e84e: chore: moved dev deps from the workspace packages to the typescript root for consistency
- 8a2e84e: chore: fixed codeql vulnerabilities
- 8a2e84e: ## Inspector: Faster Direct-to-Proxy Fallback
  - **Reduced connection timeout from 30s to 5s** for faster fallback when direct connections fail
  - **Removed automatic HTTP → SSE transport fallback** since SSE is deprecated
    - Added `disableSseFallback` option to `HttpConnector` to prevent automatic fallback to SSE transport
    - Inspector now explicitly uses HTTP transport only, relying on Direct → Proxy fallback instead
    - Users can still manually select SSE transport if needed
  - **Total fallback time: ~6 seconds** (5s timeout + 1s delay) instead of ~31 seconds

  ## Deployment: Fixed Supabase Health Check
  - **Fixed deploy.sh MCP server health check** to use POST instead of GET
    - SSE endpoints hang on GET requests, causing script to timeout
    - POST requests return immediately (415 error), proving server is up
    - Script now correctly detects when deployment is complete and shows success summary with URLs

- Updated dependencies [8a2e84e]
- Updated dependencies [8a2e84e]
- Updated dependencies [8a2e84e]
- Updated dependencies [8a2e84e]
- Updated dependencies [8a2e84e]
- Updated dependencies [8a2e84e]
- Updated dependencies [8a2e84e]
- Updated dependencies [8a2e84e]
- Updated dependencies [8a2e84e]
- Updated dependencies [8a2e84e]
- Updated dependencies [8a2e84e]
- Updated dependencies [8a2e84e]
- Updated dependencies [8a2e84e]
  - @mcp-use/inspector@0.13.0
  - mcp-use@1.11.0

## 2.6.0-canary.20

### Patch Changes

- a90ac6f: chore: fixed codeql vulnerabilities
- Updated dependencies [a90ac6f]
  - @mcp-use/inspector@0.13.0-canary.20
  - mcp-use@1.11.0-canary.20

## 2.6.0-canary.19

### Patch Changes

- Updated dependencies [1adbb26]
  - @mcp-use/inspector@0.13.0-canary.19
  - mcp-use@1.11.0-canary.19

## 2.6.0-canary.18

### Patch Changes

- Updated dependencies [2902a2e]
- Updated dependencies [d7797b6]
- Updated dependencies [168a2e1]
  - @mcp-use/inspector@0.13.0-canary.18
  - mcp-use@1.11.0-canary.18

## 2.6.0-canary.17

### Patch Changes

- c24cafb: ## Inspector: Faster Direct-to-Proxy Fallback
  - **Reduced connection timeout from 30s to 5s** for faster fallback when direct connections fail
  - **Removed automatic HTTP → SSE transport fallback** since SSE is deprecated
    - Added `disableSseFallback` option to `HttpConnector` to prevent automatic fallback to SSE transport
    - Inspector now explicitly uses HTTP transport only, relying on Direct → Proxy fallback instead
    - Users can still manually select SSE transport if needed
  - **Total fallback time: ~6 seconds** (5s timeout + 1s delay) instead of ~31 seconds

  ## Deployment: Fixed Supabase Health Check
  - **Fixed deploy.sh MCP server health check** to use POST instead of GET
    - SSE endpoints hang on GET requests, causing script to timeout
    - POST requests return immediately (415 error), proving server is up
    - Script now correctly detects when deployment is complete and shows success summary with URLs

- Updated dependencies [c24cafb]
  - mcp-use@1.11.0-canary.17
  - @mcp-use/inspector@0.13.0-canary.17

## 2.6.0-canary.16

### Patch Changes

- Updated dependencies [7eb280f]
  - mcp-use@1.11.0-canary.16
  - @mcp-use/inspector@0.13.0-canary.16

## 2.6.0-canary.15

### Patch Changes

- Updated dependencies [0a7a19a]
  - @mcp-use/inspector@0.13.0-canary.15
  - mcp-use@1.11.0-canary.15

## 2.6.0-canary.14

### Patch Changes

- Updated dependencies [f5dfa51]
  - @mcp-use/inspector@0.13.0-canary.14
  - mcp-use@1.11.0-canary.14

## 2.6.0-canary.13

### Patch Changes

- Updated dependencies [f7623fc]
  - @mcp-use/inspector@0.13.0-canary.13
  - mcp-use@1.11.0-canary.13

## 2.6.0-canary.12

### Patch Changes

- 68d1520: chore: moved dev deps from the workspace packages to the typescript root for consistency
- Updated dependencies [68d1520]
  - @mcp-use/inspector@0.13.0-canary.12
  - mcp-use@1.11.0-canary.12

## 2.6.0-canary.11

### Patch Changes

- cf72b53: fix: import from mcp-use/client instead of main entry to avoid mixing dependencies
- Updated dependencies [cf72b53]
  - mcp-use@1.11.0-canary.11
  - @mcp-use/inspector@0.13.0-canary.11

## 2.6.0-canary.10

### Patch Changes

- 14c015e: fix: trigger changeset
- Updated dependencies [14c015e]
  - @mcp-use/inspector@0.13.0-canary.10
  - mcp-use@1.11.0-canary.10

## 2.6.0-canary.9

### Patch Changes

- Updated dependencies [0262b5c]
  - mcp-use@1.11.0-canary.9
  - @mcp-use/inspector@0.13.0-canary.9

## 2.6.0-canary.8

### Minor Changes

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

### Patch Changes

- 3945a10: fix: widgets
- Updated dependencies [3945a10]
- Updated dependencies [3945a10]
  - mcp-use@1.11.0-canary.8
  - @mcp-use/inspector@0.13.0-canary.8

## 2.6.0-canary.7

### Patch Changes

- Updated dependencies [9acf03b]
  - @mcp-use/inspector@0.13.0-canary.7
  - mcp-use@1.11.0-canary.7

## 2.6.0-canary.6

### Patch Changes

- fdbd09e: fix: widgets do not pick up mcp-use styles
- Updated dependencies [fdbd09e]
  - mcp-use@1.11.0-canary.6
  - @mcp-use/inspector@0.13.0-canary.6

## 2.6.0-canary.5

### Patch Changes

- Updated dependencies [0b2292d]
- Updated dependencies [861546b]
  - mcp-use@1.11.0-canary.5
  - @mcp-use/inspector@0.13.0-canary.5

## 2.6.0-canary.4

### Patch Changes

- Updated dependencies [f469d26]
  - mcp-use@1.11.0-canary.4
  - @mcp-use/inspector@0.13.0-canary.4

## 2.6.0-canary.3

### Minor Changes

- e302f8d: feat: added support for cli client

### Patch Changes

- Updated dependencies [e302f8d]
- Updated dependencies [e302f8d]
  - mcp-use@1.11.0-canary.3
  - @mcp-use/inspector@0.13.0-canary.3

## 2.5.6

### Patch Changes

- Updated dependencies [918287c]
  - mcp-use@1.10.6
  - @mcp-use/inspector@0.12.6

## 2.5.5

### Patch Changes

- Updated dependencies [dcf938f]
  - mcp-use@1.10.5
  - @mcp-use/inspector@0.12.5

## 2.5.4

### Patch Changes

- fix: deno 5
- Updated dependencies
  - mcp-use@1.10.4
  - @mcp-use/inspector@0.12.4

## 2.5.3

### Patch Changes

- Updated dependencies
  - @mcp-use/inspector@0.12.3
  - mcp-use@1.10.3

## 2.5.2

### Patch Changes

- Updated dependencies
  - @mcp-use/inspector@0.12.2
  - mcp-use@1.10.2

## 2.5.1

### Patch Changes

- Updated dependencies [b3d69ed]
  - @mcp-use/inspector@0.12.1
  - mcp-use@1.10.1

## 2.5.1-canary.2

### Patch Changes

- Updated dependencies [1b6562a]
  - mcp-use@1.10.1-canary.2
  - @mcp-use/inspector@0.12.1-canary.2

## 2.5.1-canary.1

### Patch Changes

- Updated dependencies [2bb2278]
  - mcp-use@1.10.1-canary.1
  - @mcp-use/inspector@0.12.1-canary.1

## 2.5.1-canary.0

### Patch Changes

- 122a36c: Added repository metadata in package.json
- Updated dependencies [122a36c]
  - @mcp-use/inspector@0.12.1-canary.0
  - mcp-use@1.10.1-canary.0

## 2.5.0

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
- 6ec11cd: fix: fix transport bug
- 6ec11cd: chore: fix types
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
- Updated dependencies [6ec11cd]
  - @mcp-use/inspector@0.12.0
  - mcp-use@1.10.0

## 2.5.0-canary.11

### Patch Changes

- Updated dependencies [f0fc5a2]
  - mcp-use@1.10.0-canary.11
  - @mcp-use/inspector@0.12.0-canary.11

## 2.5.0-canary.10

### Patch Changes

- Updated dependencies [0633fbd]
  - @mcp-use/inspector@0.12.0-canary.10
  - mcp-use@1.10.0-canary.10

## 2.5.0-canary.9

### Patch Changes

- Updated dependencies [79ce293]
  - @mcp-use/inspector@0.12.0-canary.9
  - mcp-use@1.10.0-canary.9

## 2.5.0-canary.8

### Patch Changes

- Updated dependencies [54ccbd8]
  - mcp-use@1.10.0-canary.8
  - @mcp-use/inspector@0.12.0-canary.8

## 2.5.0-canary.7

### Patch Changes

- Updated dependencies [48b0133]
  - mcp-use@1.10.0-canary.7
  - @mcp-use/inspector@0.12.0-canary.7

## 2.5.0-canary.6

### Patch Changes

- Updated dependencies [c4fe367]
  - @mcp-use/inspector@0.12.0-canary.6
  - mcp-use@1.10.0-canary.6

## 2.5.0-canary.5

### Patch Changes

- Updated dependencies [4d61e84]
  - @mcp-use/inspector@0.12.0-canary.5
  - mcp-use@1.10.0-canary.5

## 2.5.0-canary.4

### Patch Changes

- Updated dependencies [4f8c871]
  - mcp-use@1.10.0-canary.4
  - @mcp-use/inspector@0.12.0-canary.4

## 2.5.0-canary.3

### Patch Changes

- 1379b00: chore: fix types
- Updated dependencies [1379b00]
  - @mcp-use/inspector@0.12.0-canary.3
  - mcp-use@1.10.0-canary.3

## 2.5.0-canary.2

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

### Patch Changes

- Updated dependencies [96e4097]
  - @mcp-use/inspector@0.12.0-canary.2
  - mcp-use@1.10.0-canary.2

## 2.4.9-canary.1

### Patch Changes

- Updated dependencies [94f4852]
  - mcp-use@1.9.1-canary.1
  - @mcp-use/inspector@0.11.1-canary.1

## 2.4.9-canary.0

### Patch Changes

- 4d1aa19: fix: refactor to use https://github.com/modelcontextprotocol/typescript-sdk/pull/1209
- Updated dependencies [4d1aa19]
  - @mcp-use/inspector@0.11.1-canary.0
  - mcp-use@1.9.1-canary.0

## 2.4.8

### Patch Changes

- 4fc04a9: fix: fix transport bug
- Updated dependencies [4fc04a9]
- Updated dependencies [4fc04a9]
- Updated dependencies [4fc04a9]
- Updated dependencies [4fc04a9]
  - @mcp-use/inspector@0.11.0
  - mcp-use@1.9.0

## 2.4.8-canary.3

### Patch Changes

- b0d1ffe: fix: fix transport bug
- Updated dependencies [b0d1ffe]
  - @mcp-use/inspector@0.11.0-canary.3
  - mcp-use@1.9.0-canary.3

## 2.4.8-canary.2

### Patch Changes

- Updated dependencies [b56c907]
  - @mcp-use/inspector@0.11.0-canary.2
  - mcp-use@1.9.0-canary.2

## 2.4.8-canary.1

### Patch Changes

- Updated dependencies [b4e960a]
  - mcp-use@1.9.0-canary.1
  - @mcp-use/inspector@0.10.2-canary.1

## 2.4.8-canary.0

### Patch Changes

- Updated dependencies [d726bfa]
  - @mcp-use/inspector@0.10.2-canary.0
  - mcp-use@1.8.2-canary.0

## 2.4.7

### Patch Changes

- Updated dependencies [4bf21f3]
  - @mcp-use/inspector@0.10.1
  - mcp-use@1.8.1

## 2.4.7-canary.0

### Patch Changes

- Updated dependencies [33a1a69]
  - @mcp-use/inspector@0.10.1-canary.0
  - mcp-use@1.8.1-canary.0

## 2.4.6

### Patch Changes

- Updated dependencies [00b19c5]
  - @mcp-use/inspector@0.10.0
  - mcp-use@1.8.0

## 2.4.6-canary.0

### Patch Changes

- Updated dependencies [de6ca09]
  - @mcp-use/inspector@0.10.0-canary.0
  - mcp-use@1.8.0-canary.0

## 2.4.5

### Patch Changes

- a4341d5: chore: update deps
- Updated dependencies [a4341d5]
  - @mcp-use/inspector@0.9.2
  - mcp-use@1.7.2

## 2.4.5-canary.0

### Patch Changes

- c1d7378: chore: update deps
- Updated dependencies [c1d7378]
  - @mcp-use/inspector@0.9.2-canary.0
  - mcp-use@1.7.2-canary.0

## 2.4.4

### Patch Changes

- f6f2b61: fix lint & format
- Updated dependencies [f6f2b61]
- Updated dependencies [f6f2b61]
  - @mcp-use/inspector@0.9.1
  - mcp-use@1.7.1

## 2.4.4-canary.1

### Patch Changes

- c9cb2db: fix lint & format
- Updated dependencies [c9cb2db]
  - @mcp-use/inspector@0.9.1-canary.1
  - mcp-use@1.7.1-canary.1

## 2.4.4-canary.0

### Patch Changes

- Updated dependencies [bab4ad0]
  - @mcp-use/inspector@0.9.1-canary.0
  - mcp-use@1.7.1-canary.0

## 2.4.3

### Patch Changes

- 2730902: Optimized dependencies
- 2730902: chore: fixed readme of package.json
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
- Updated dependencies [2730902]
  - @mcp-use/inspector@0.9.0
  - mcp-use@1.7.0

## 2.4.3-canary.8

### Patch Changes

- 0daae72: chore: fixed readme of package.json
  - mcp-use@1.7.0-canary.8
  - @mcp-use/inspector@0.9.0-canary.8

## 2.4.3-canary.7

### Patch Changes

- Updated dependencies [caf8c7c]
- Updated dependencies [caf8c7c]
- Updated dependencies [caf8c7c]
  - @mcp-use/inspector@0.9.0-canary.7
  - mcp-use@1.7.0-canary.7

## 2.4.3-canary.6

### Patch Changes

- Updated dependencies [38da68d]
- Updated dependencies [38da68d]
  - @mcp-use/inspector@0.9.0-canary.6
  - mcp-use@1.7.0-canary.6

## 2.4.3-canary.5

### Patch Changes

- Updated dependencies [4b917e0]
  - @mcp-use/inspector@0.9.0-canary.5
  - mcp-use@1.7.0-canary.5

## 2.4.3-canary.4

### Patch Changes

- Updated dependencies [f44e60f]
  - @mcp-use/inspector@0.9.0-canary.4
  - mcp-use@1.7.0-canary.4

## 2.4.3-canary.3

### Patch Changes

- Updated dependencies [0c8cb1a]
  - mcp-use@1.7.0-canary.3
  - @mcp-use/inspector@0.9.0-canary.3

## 2.4.3-canary.2

### Patch Changes

- 1ca9801: Optimized dependencies
- Updated dependencies [1ca9801]
  - @mcp-use/inspector@0.9.0-canary.2
  - mcp-use@1.7.0-canary.2

## 2.4.3-canary.1

### Patch Changes

- Updated dependencies [6bb0f3d]
  - @mcp-use/inspector@0.9.0-canary.1
  - mcp-use@1.7.0-canary.1

## 2.4.3-canary.0

### Patch Changes

- Updated dependencies [041da75]
- Updated dependencies [041da75]
  - @mcp-use/inspector@0.8.3-canary.0
  - mcp-use@1.6.3-canary.0

## 2.4.2

### Patch Changes

- Updated dependencies [7e7c9a5]
  - @mcp-use/inspector@0.8.2
  - mcp-use@1.6.2

## 2.4.2-canary.0

### Patch Changes

- Updated dependencies [0530e6a]
  - @mcp-use/inspector@0.8.2-canary.0
  - mcp-use@1.6.2-canary.0

## 2.4.1

### Patch Changes

- c8e30ec: chore: update patch
- Updated dependencies [1a509bf]
- Updated dependencies [c60c055]
- Updated dependencies [4950e56]
- Updated dependencies [1a509bf]
- Updated dependencies [c8e30ec]
  - mcp-use@1.6.1
  - @mcp-use/inspector@0.8.1

## 2.4.1-canary.1

### Patch Changes

- 2389cfb: chore: update patch
  - mcp-use@1.6.1-canary.1
  - @mcp-use/inspector@0.8.1-canary.1

## 2.4.1-canary.0

### Patch Changes

- Updated dependencies [9974d55]
- Updated dependencies [e9e4075]
- Updated dependencies [32c6790]
- Updated dependencies [299ce65]
- Updated dependencies [0e77821]
  - mcp-use@1.6.1-canary.0
  - @mcp-use/inspector@0.8.1-canary.0

## 2.4.0

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
- Updated dependencies [7e4dd9b]
  - @mcp-use/inspector@0.8.0
  - mcp-use@1.6.0

## 2.3.1-canary.7

### Patch Changes

- Updated dependencies [94b9824]
  - @mcp-use/inspector@0.7.1-canary.7
  - mcp-use@1.5.1-canary.7

## 2.3.1-canary.6

### Patch Changes

- Updated dependencies [a3295a0]
  - mcp-use@1.5.1-canary.6
  - @mcp-use/inspector@0.7.1-canary.6

## 2.3.1-canary.5

### Patch Changes

- Updated dependencies [95fa604]
  - mcp-use@1.5.1-canary.5
  - @mcp-use/inspector@0.7.1-canary.5

## 2.3.1-canary.4

### Patch Changes

- Updated dependencies [a93befb]
  - mcp-use@1.5.1-canary.4
  - @mcp-use/inspector@0.7.1-canary.4

## 2.3.1-canary.3

### Patch Changes

- Updated dependencies [ccc2df3]
  - mcp-use@1.5.1-canary.3
  - @mcp-use/inspector@0.7.1-canary.3

## 2.3.1-canary.2

### Patch Changes

- Updated dependencies [e5e8e1b]
  - mcp-use@1.5.1-canary.2
  - @mcp-use/inspector@0.7.1-canary.2

## 2.3.1-canary.1

### Patch Changes

- Updated dependencies [4ca7772]
  - mcp-use@1.5.1-canary.1
  - @mcp-use/inspector@0.7.1-canary.1

## 2.3.1-canary.0

### Patch Changes

- 12a88c7: fix versions
- Updated dependencies [12a88c7]
  - @mcp-use/inspector@0.7.1-canary.0
  - mcp-use@1.5.1-canary.0

## 2.3.0

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

### Patch Changes

- Updated dependencies [266a445]
- Updated dependencies [266a445]
- Updated dependencies [266a445]
- Updated dependencies [266a445]
  - @mcp-use/inspector@0.7.0
  - mcp-use@1.5.0

## 2.3.0-canary.3

### Minor Changes

- 018395c: Release canary

### Patch Changes

- Updated dependencies [018395c]
  - @mcp-use/inspector@0.7.0-canary.3
  - mcp-use@1.5.0-canary.3

## 2.3.0-canary.2

### Patch Changes

- Updated dependencies [229a3a3]
  - @mcp-use/inspector@0.7.0-canary.2
  - mcp-use@1.5.0-canary.2

## 2.3.0-canary.1

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

### Patch Changes

- Updated dependencies [fc64bd7]
  - @mcp-use/inspector@0.7.0-canary.1
  - mcp-use@1.5.0-canary.1

## 2.2.5

### Patch Changes

- Updated dependencies [95c9d9f]
- Updated dependencies [95c9d9f]
  - mcp-use@1.4.1
  - @mcp-use/inspector@0.6.1

## 2.2.5-canary.1

### Patch Changes

- Updated dependencies [0975320]
  - mcp-use@1.4.1-canary.1
  - @mcp-use/inspector@0.6.1-canary.1

## 2.2.5-canary.0

### Patch Changes

- Updated dependencies [d434691]
  - mcp-use@1.4.1-canary.0
  - @mcp-use/inspector@0.6.1-canary.0

## 2.2.4

### Patch Changes

- 33e4a68: Fix deployment from source
- Updated dependencies [33e4a68]
- Updated dependencies [33e4a68]
- Updated dependencies [33e4a68]
  - @mcp-use/inspector@0.6.0
  - mcp-use@1.4.0

## 2.2.4-canary.3

### Patch Changes

- Updated dependencies [35fd9ae]
  - mcp-use@1.4.0-canary.3
  - @mcp-use/inspector@0.6.0-canary.3

## 2.2.4-canary.2

### Patch Changes

- c754733: Fix deployment from source
  - mcp-use@1.3.4-canary.2
  - @mcp-use/inspector@0.6.0-canary.2

## 2.2.4-canary.1

### Patch Changes

- Updated dependencies [451c507]
  - @mcp-use/inspector@0.6.0-canary.1
  - mcp-use@1.3.4-canary.1

## 2.2.4-canary.0

### Patch Changes

- Updated dependencies [1f4a798]
  - @mcp-use/inspector@0.6.0-canary.0
  - mcp-use@1.3.4-canary.0

## 2.2.3

### Patch Changes

- e8ec993: Add ability to reuse tunnel subdomain when using mcp-use start
- e8ec993: Remove irrelevant log statement
- e8ec993: - Add emulation of openai api to the inspector
  - Add utility component WidgetFullscreenWrapper: render full screen and pip buttons
  - Add utility component WidgetDebugger: shows an overlay with openai metadata for debugging ChatGPT integration
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
- Updated dependencies [e8ec993]
  - @mcp-use/inspector@0.5.3
  - mcp-use@1.3.3

## 2.2.3-canary.8

### Patch Changes

- Updated dependencies [329ce35]
  - @mcp-use/inspector@0.5.3-canary.8
  - mcp-use@1.3.3-canary.8

## 2.2.3-canary.7

### Patch Changes

- Updated dependencies [1ed0ab8]
  - @mcp-use/inspector@0.5.3-canary.7
  - mcp-use@1.3.3-canary.7

## 2.2.3-canary.6

### Patch Changes

- Updated dependencies [ba654db]
  - @mcp-use/inspector@0.5.3-canary.6
  - mcp-use@1.3.3-canary.6

## 2.2.3-canary.5

### Patch Changes

- Updated dependencies [f971dd8]
  - @mcp-use/inspector@0.5.3-canary.5
  - mcp-use@1.3.3-canary.5

## 2.2.3-canary.4

### Patch Changes

- 68d0d4c: Remove irrelevant log statement
- 68d0d4c: - Add emulation of openai api to the inspector
  - Add utility component WidgetFullscreenWrapper: render full screen and pip buttons
  - Add utility component WidgetDebugger: shows an overlay with openai metadata for debugging ChatGPT integration
- Updated dependencies [68d0d4c]
  - @mcp-use/inspector@0.5.3-canary.4
  - mcp-use@1.3.3-canary.4

## 2.2.3-canary.3

### Patch Changes

- Updated dependencies [d4dc001]
  - mcp-use@1.3.3-canary.3
  - @mcp-use/inspector@0.5.3-canary.3

## 2.2.3-canary.2

### Patch Changes

- Updated dependencies [9fc286c]
  - mcp-use@1.3.3-canary.2
  - @mcp-use/inspector@0.5.3-canary.2

## 2.2.3-canary.1

### Patch Changes

- f7995c0: Add ability to reuse tunnel subdomain when using mcp-use start
  - mcp-use@1.3.3-canary.1
  - @mcp-use/inspector@0.5.3-canary.1

## 2.2.3-canary.0

### Patch Changes

- Updated dependencies [d4c246a]
  - @mcp-use/inspector@0.5.3-canary.0
  - mcp-use@1.3.3-canary.0

## 2.2.2

### Patch Changes

- 835d367: fix inspector generated url
- 835d367: fix with-inspector param
- 835d367: make installation disabled by default and add deploy command to template package
- 835d367: chore: update dependencies
- 835d367: fix upload source
- Updated dependencies [835d367]
- Updated dependencies [835d367]
- Updated dependencies [835d367]
- Updated dependencies [835d367]
  - @mcp-use/inspector@0.5.2
  - mcp-use@1.3.2

## 2.2.2-canary.5

### Patch Changes

- Updated dependencies [d9e3ae2]
  - mcp-use@1.3.2-canary.5
  - @mcp-use/inspector@0.5.2-canary.5

## 2.2.2-canary.4

### Patch Changes

- Updated dependencies [9db6706]
  - @mcp-use/inspector@0.5.2-canary.4
  - mcp-use@1.3.2-canary.4

## 2.2.2-canary.3

### Patch Changes

- 6133446: make installation disabled by default and add deploy command to template package
  - mcp-use@1.3.2-canary.3
  - @mcp-use/inspector@0.5.2-canary.3

## 2.2.2-canary.2

### Patch Changes

- 6e3278b: fix inspector generated url
  - mcp-use@1.3.2-canary.2
  - @mcp-use/inspector@0.5.2-canary.2

## 2.2.2-canary.1

### Patch Changes

- ecfa449: fix upload source
  - mcp-use@1.3.2-canary.1
  - @mcp-use/inspector@0.5.2-canary.1

## 2.2.2-canary.0

### Patch Changes

- 2ebe233: fix with-inspector param
- 2ebe233: chore: update dependencies
- Updated dependencies [2ebe233]
- Updated dependencies [2ebe233]
  - @mcp-use/inspector@0.5.2-canary.0
  - mcp-use@1.3.2-canary.0

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
