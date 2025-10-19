/**
 * MCP Inspector - Middleware for mounting inspector UI on Express apps
 *
 * This is the main entry point for importing the inspector as a library.
 * For standalone server usage, see standalone.ts
 */

export { mountInspector } from './middleware.js'

// Export browser-compatible chat utilities for client-side usage
export { handleChatRequest, handleChatRequestStream } from './shared-utils-browser.js'
