export {
  createMCPServer,
  MCPServer,
  type McpServerInstance,
} from "./mcp-server.js";

// Export version information (global)
export { getPackageVersion, VERSION } from "../version.js";

// Re-export tool context types
export type {
  ElicitFormParams,
  ElicitOptions,
  ElicitUrlParams,
  SampleOptions,
  ToolContext,
} from "./types/tool-context.js";

export * from "./types/index.js";

// Context storage utilities for accessing HTTP request context in tools
export {
  getRequestContext,
  hasRequestContext,
  runWithContext,
} from "./context-storage.js";

// Response helper utilities for tools and resources
export {
  array,
  audio,
  binary,
  css,
  error,
  // MIME-specific helpers for resources
  html,
  image,
  javascript,
  markdown,
  mix,
  object,
  resource,
  text,
  widget,
  xml,
  type TypedCallToolResult,
  type WidgetResponseConfig,
} from "./utils/response-helpers.js";

// OAuth utilities for authentication and authorization
export {
  getAuth,
  hasAnyScope,
  hasScope,
  oauthAuth0Provider,
  oauthCustomProvider,
  oauthKeycloakProvider,
  oauthSupabaseProvider,
  oauthWorkOSProvider,
  requireAnyScope,
  requireScope,
  type Auth0ProviderConfig,
  type AuthInfo,
  type CustomProviderConfig,
  type KeycloakProviderConfig,
  type OAuthProvider,
  type SupabaseProviderConfig,
  type UserInfo,
  type WorkOSProviderConfig,
} from "./oauth/index.js";

// Session storage utilities for pluggable persistence
export {
  FileSystemSessionStore,
  InMemorySessionStore,
  RedisSessionStore,
  type FileSystemSessionStoreConfig,
  type RedisClient,
  type RedisSessionStoreConfig,
  type SessionData,
  type SessionMetadata,
  type SessionStore,
} from "./sessions/index.js";

// Stream management utilities for active SSE connections
export {
  InMemoryStreamManager,
  RedisStreamManager,
  type RedisStreamManagerConfig,
  type StreamManager,
} from "./sessions/index.js";

// MCP-UI adapter utility functions
export {
  buildWidgetUrl,
  createExternalUrlResource,
  createRawHtmlResource,
  createRemoteDomResource,
  createUIResourceFromDefinition,
  type UrlConfig,
} from "./widgets/mcp-ui-adapter.js";

// Middleware adapter utility functions
export {
  adaptConnectMiddleware,
  adaptMiddleware,
  isExpressMiddleware,
} from "./connect-adapter.js";

// MCP Proxy middleware for CORS proxying
export { mountMcpProxy, type McpProxyOptions } from "./middleware/mcp-proxy.js";

export type {
  DiscoverWidgetsOptions,
  ExternalUrlUIResource,
  GetPromptResult,
  InputDefinition,
  McpContext,
  PromptCallback,
  PromptDefinition,
  PromptResult,
  RawHtmlUIResource,
  ReadResourceCallback,
  ReadResourceTemplateCallback,
  RemoteDomUIResource,
  ResourceDefinition,
  ServerConfig,
  // MCP SDK type re-exports
  ToolAnnotations,
  ToolCallback,
  ToolDefinition,
  // UIResource specific types
  UIResourceDefinition,
  WidgetConfig,
  WidgetManifest,
  WidgetProps,
} from "./types/index.js";
