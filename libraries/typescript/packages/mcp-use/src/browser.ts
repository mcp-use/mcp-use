/**
 * Browser entry point - exports OAuth utilities and MCP client/agent for browser-based MCP usage
 */

// Export core client and agent classes - these work in both Node.js and browser
export { BrowserMCPClient as MCPClient } from './client/browser.js'
export { MCPAgent } from './agents/mcp_agent.js'
export { RemoteAgent } from './agents/remote.js'

// Export adapters
export { BaseAdapter, LangChainAdapter } from './adapters/index.js'

// Export connectors that work in the browser
export { BaseConnector } from './connectors/base.js'
export { HttpConnector } from './connectors/http.js'
export { WebSocketConnector } from './connectors/websocket.js'

// Export session
export { MCPSession } from './session.js'

// Export OAuth utilities
export { BrowserOAuthClientProvider } from './auth/browser-provider.js'
export { onMcpAuthorization } from './auth/callback.js'
export type { StoredState } from './auth/types.js'

// Export logging (uses browser console in browser environments)
export { Logger, logger } from './logging.js'

// Export observability
export { type ObservabilityConfig, ObservabilityManager } from './observability/index.js'

// Export AI SDK utilities
export * from './agents/utils/index.js'

// Re-export message classes to ensure a single constructor instance is shared by consumers
export { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'

// Re-export StreamEvent type from LangChain for convenience
export type { StreamEvent } from '@langchain/core/tracers/log_stream'

// Re-export useful SDK types
export type { OAuthClientInformation, OAuthMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
