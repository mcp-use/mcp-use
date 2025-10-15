/**
 * Entry point for the React integration.
 * Provides the useMcp hook and related types.
 */

export { useMcp } from './useMcp.js'
export type { UseMcpOptions, UseMcpResult } from './types.js'

// Re-export auth callback handler for OAuth flow
export { onMcpAuthorization } from '../auth/callback.js'

// Re-export core types for convenience when using hook result
export type { Tool, Resource, ResourceTemplate, Prompt } from '@modelcontextprotocol/sdk/types.js'
