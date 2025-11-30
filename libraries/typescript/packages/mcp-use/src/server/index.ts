export {
  createMCPServer,
  type McpServerInstance,
  type ToolContext,
  type SampleOptions,
} from "./mcp-server.js";

export * from "./types/index.js";

// Context storage utilities for accessing HTTP request context in tools
export {
  getRequestContext,
  runWithContext,
  hasRequestContext,
} from "./context-storage.js";

// Response helper utilities for tool results
export {
  text,
  image,
  resource,
  error,
  object,
  array,
  widget,
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
} from "./adapters/mcp-ui-adapter.js";

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
} from "./types/index.js";
