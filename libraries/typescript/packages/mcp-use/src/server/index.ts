export {
  MCPServer,
  createMCPServer,
  type McpServerInstance,
} from "./mcp-server.js";

// Re-export tool context types
export type {
  ToolContext,
  SampleOptions,
  ElicitOptions,
  ElicitFormParams,
  ElicitUrlParams,
} from "./types/tool-context.js";

export * from "./types/index.js";

// Context storage utilities for accessing HTTP request context in tools
export {
  getRequestContext,
  runWithContext,
  hasRequestContext,
} from "./context-storage.js";

// Response helper utilities for tools and resources
export {
  text,
  image,
  resource,
  error,
  object,
  array,
  widget,
  mix,
  audio,
  // MIME-specific helpers for resources
  html,
  markdown,
  xml,
  css,
  javascript,
  binary,
  type WidgetResponseConfig,
  type TypedCallToolResult,
} from "./utils/response-helpers.js";

// OAuth utilities for authentication and authorization
export {
  getAuth,
  hasScope,
  hasAnyScope,
  requireScope,
  requireAnyScope,
  oauthSupabaseProvider,
  oauthAuth0Provider,
  oauthKeycloakProvider,
  oauthWorkOSProvider,
  oauthCustomProvider,
  type AuthInfo,
  type OAuthProvider,
  type UserInfo,
  type SupabaseProviderConfig,
  type Auth0ProviderConfig,
  type KeycloakProviderConfig,
  type WorkOSProviderConfig,
  type CustomProviderConfig,
} from "./oauth/index.js";

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

export type {
  DiscoverWidgetsOptions,
  ExternalUrlUIResource,
  InputDefinition,
  McpContext,
  PromptCallback,
  PromptDefinition,
  RawHtmlUIResource,
  ReadResourceCallback,
  ReadResourceTemplateCallback,
  RemoteDomUIResource,
  ResourceDefinition,
  ServerConfig,
  ToolCallback,
  ToolDefinition,
  // UIResource specific types
  UIResourceDefinition,
  WidgetConfig,
  WidgetManifest,
  WidgetProps,
  // MCP SDK type re-exports
  ToolAnnotations,
  GetPromptResult,
  PromptResult,
} from "./types/index.js";
