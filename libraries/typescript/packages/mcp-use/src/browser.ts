/**
 * Browser entry point - exports OAuth utilities for browser-based MCP usage
 */

export { BrowserOAuthClientProvider } from './auth/browser-provider.js'
export { onMcpAuthorization } from './auth/callback.js'
export type { StoredState } from './auth/types.js'

// Re-export useful SDK types
export type { OAuthClientInformation, OAuthMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
