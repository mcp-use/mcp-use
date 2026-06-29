export { MCPServer, type McpServerInstance } from "./mcp-server.js";
export type {
  CodeModeContext,
  CodeModeExecuteRequest,
  CodeModeSandboxBackend,
  CodeModeSearchRequest,
  CodeModeToolDescriptor,
  CodeModeToolPolicy,
  EnableCodeModeOptions,
} from "./code-mode.js";
export type {
  FromOpenAPIOptions,
  OpenAPIAuth,
  OpenAPIDocument,
  OpenAPIExcludeRule,
} from "./openapi/index.js";

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

// Client capability utilities
export {
  supportsApps,
  type UserContext,
} from "./tools/tool-execution-helpers.js";

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
  view,
  widget,
  xml,
  type TypedCallToolResult,
  type ViewResponseConfig,
  type WidgetResponseConfig,
} from "./utils/response-helpers.js";

export {
  streamable,
  isStreamable,
  type Streamable,
} from "./utils/streamable.js";

export { mountViews, mountWidgets } from "./views/index.js";

// Completion utilities for prompt arguments
export {
  completable,
  type Completable,
  type CompletionContext,
} from "./utils/completion-helpers.js";
export {
  enumSchema,
  legacyEnum,
  titledEnum,
  titledMultiEnum,
  untitledEnum,
  untitledMultiEnum,
  type ElicitationEnumFieldSchema,
  type ElicitationEnumObjectSchema,
  type EnumOption,
  type LegacyEnumOption,
  type LegacyEnumSchema,
  type TitledEnumSchema,
  type TitledMultiEnumSchema,
  type UntitledEnumSchema,
  type UntitledMultiEnumSchema,
} from "./utils/elicitation-helpers.js";

// OAuth utilities for authentication and authorization
export {
  getAuth,
  getAuthContext,
  hasAnyScope,
  hasRole,
  hasScope,
  jwksVerifier,
  oauthAuth0Provider,
  oauthBetterAuthProvider,
  oauthClerkProvider,
  oauthCustomProvider,
  oauthKeycloakProvider,
  oauthProxy,
  oauthSupabaseProvider,
  oauthWorkOSProvider,
  requireAnyScope,
  requireScope,
  type AuthContext,
  type AuthDecision,
  type Auth0ProviderConfig,
  type AuthInfo,
  type AuthPredicate,
  type AuthRequirement,
  type AuthRequirementSummary,
  type BetterAuthProviderConfig,
  type ClerkProviderConfig,
  type CustomProviderConfig,
  type JwksVerifierConfig,
  type KeycloakProviderConfig,
  type OAuthProvider,
  type OAuthProxy,
  type OAuthProxyConfig,
  type Policy,
  type PolicyRequest,
  type SupabaseProviderConfig,
  type UserInfo,
  type VerifyToken,
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
  createMcpAppsResource,
  createUIResourceFromDefinition,
  type UrlConfig,
} from "./views/mcp-ui-adapter.js";

// Protocol adapters for dual-protocol widget support
export {
  AppsSdkAdapter,
  McpAppsAdapter,
  type CSPConfig,
  type ProtocolAdapter,
  type UnifiedWidgetMetadata,
} from "./views/adapters/index.js";

// MCP Apps Extension constants (inlined — see mcp-apps-constants.ts)
export {
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from "./views/mcp-apps-constants.js";

// Middleware adapter utility functions
export {
  adaptConnectMiddleware,
  adaptMiddleware,
  isExpressMiddleware,
} from "./connect-adapter.js";

// MCP Proxy middleware for CORS proxying
export { mountMcpProxy, type McpProxyOptions } from "./middleware/mcp-proxy.js";

// MCP operation-level middleware
export {
  composeMiddleware,
  matchesPattern,
  type McpMiddlewareEntry,
  type McpMiddlewareFn,
  type McpMiddlewareFnFor,
  type McpMiddlewarePatternMap,
  type MiddlewareContext,
  type ToolsCallMiddlewareContext,
  type ResourcesReadMiddlewareContext,
  type PromptsGetMiddlewareContext,
} from "./middleware/mcp-middleware.js";
export {
  AuthzPolicyError,
  createAuthzMiddleware,
  evaluateAuthRequirement,
} from "./middleware/policy.js";
export {
  DEFAULT_IDEMPOTENCY_STATE_KEY,
  DEFAULT_TIMEOUT_SIGNAL_STATE_KEY,
  TimeoutPolicyError,
  createAuditLogMiddleware,
  createIdempotencyKeyMiddleware,
  createTimeoutPolicyMiddleware,
  getIdempotencyKey,
  lintMcpSecurity,
  type AuditLogEvent,
  type AuditLogMiddlewareOptions,
  type IdempotencyKeyMiddlewareOptions,
  type IdempotencyKeyOptions,
  type MutatingToolMatcher,
  type SecurityDoctorFinding,
  type SecurityDoctorInput,
  type SecurityDoctorReport,
  type SecurityDoctorSeverity,
  type SecurityDoctorTool,
  type TimeoutPolicyOptions,
} from "./middleware/production.js";

// OAuth Proxy middleware for CORS-free OAuth flows
export { mountOAuthProxy, type OAuthProxyOptions } from "./oauth/proxy.js";

// Landing page generator for browser requests
export {
  generateLandingPage,
  type LandingPageTool,
  type LandingPagePrompt,
  type LandingPageResource,
} from "./landing.js";

// Tool registry type generator (for CLI generate-types command)
export { generateToolRegistryTypes } from "./utils/tool-registry-generator.js";

export type {
  AppsSdkUIResource,
  ClientCapabilityChecker,
  ToolRef,
  DiscoverWidgetsOptions,
  GetPromptResult,
  InputDefinition,
  McpAppsUIResource,
  McpContext,
  PromptCallback,
  PromptDefinition,
  PromptResult,
  ReadResourceCallback,
  ReadResourceTemplateCallback,
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
