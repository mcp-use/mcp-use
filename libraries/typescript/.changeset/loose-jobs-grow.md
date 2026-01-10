---
"@mcp-use/inspector": patch
"mcp-use": patch
"@mcp-use/cli": patch
---

## Breaking Changes (with Deprecation Warnings)

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
