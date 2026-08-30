/**
 * Build stateless MCP servers with a Hono application and a Web-standard
 * Fetch serving boundary.
 *
 * @packageDocumentation
 */

export { MCPServer } from "./server.js";
export type { ListenOptions } from "./server.js";
export { createMcpMount } from "./mount-mcp.js";
export type { MountMcpOptions, McpMount } from "./mount-mcp.js";
export {
  composeFetch,
  getRequestBag,
  hostValidationMiddleware,
  jsonBodyMiddleware,
  matchesPath,
  matchesPathPrefix,
  originValidationMiddleware,
  pathnameOf,
} from "./fetch-app.js";
export type { FetchHandler, FetchMiddleware, RequestBag } from "./fetch-app.js";
export { registerViews } from "./views/index.js";
export { requestLogger } from "./logging.js";
export type {
  LoggingOptions,
  LogLevel,
  RequestLoggerOptions,
} from "./logging.js";
export type {
  LandingPageOptions,
  LandingPagePrompt,
  LandingPageResource,
  LandingPageTool,
} from "./landing.js";

/**
 * Wire result shapes (re-exported from the SDK): prefer returning these raw
 * shapes from callbacks — tools {@link CallToolResult}, resources
 * {@link ReadResourceResult}, prompts {@link GetPromptResult}. Deprecated
 * response helpers (`text`, `object`, …) are thin shims that produce the same
 * tool envelope; resource/prompt registration still converts helper-shaped
 * returns for upgrade compatibility.
 */
export type {
  CallToolResult,
  ContentBlock,
  GetPromptResult,
  InputRequest,
  InputRequiredResult,
  InputResponses,
  PromptMessage,
  ReadResourceResult,
} from "@modelcontextprotocol/server";
/**
 * Official SDK descriptor metadata contracts. Tools use
 * {@link ToolAnnotations}; resources and resource templates use
 * {@link Annotations}; every descriptor's extension `_meta` uses
 * {@link MetaObject}.
 */
export type {
  Annotations,
  MetaObject,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
/**
 * Official SDK helpers for authoring and reading multi-round-trip
 * `input_required` results.
 */
export {
  acceptedContent,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  isInputRequiredResult,
} from "@modelcontextprotocol/server";

export { completable } from "./completable.js";
export type { CompletionCallback, CompletionContext } from "./completable.js";

/**
 * Schema contracts accepted by `inputSchema`/`outputSchema` fields (re-exported
 * from the SDK): `StandardSchemaWithJSON` requires validation plus JSON
 * Schema conversion; `completable()` needs only `StandardSchemaV1`.
 * Implemented by zod v4, ArkType, Valibot, …
 */
export type {
  StandardSchemaV1,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";

export type { ServerConfig, CorsOptions } from "./config.js";
export { registerSkills, SKILLS_EXTENSION_ID } from "./skills/types.js";
export type {
  SkillsOptions,
  SkillsSnapshot,
  SkillDirectorySnapshot,
  SkillSnapshotEntry,
  SkillResourceSnapshot,
} from "./skills/types.js";
export type { ServerBranding } from "./branding.js";
/** Official MCP icon shape used by {@link ServerConfig.icons}. */
export type { Icon } from "@modelcontextprotocol/server";
export type {
  MiddlewareContext,
  McpMiddlewareContext,
  McpCompleteEventListenerFn,
  McpEventListenerFnFor,
  McpEventPattern,
  McpEventPatternBody,
  McpEventListenerFn,
  McpExactMiddlewareFn,
  McpMiddlewareFn,
  McpMiddlewareFnFor,
  McpMiddlewareMethod,
  McpMiddlewareMethodsForPattern,
  McpMiddlewareNext,
  McpMiddlewareOperationMap,
  McpMiddlewareParams,
  McpMiddlewarePattern,
  McpMiddlewarePatternBody,
  McpMiddlewarePatternMap,
  McpMiddlewareResult,
  PromptsGetMiddlewareContext,
  PromptsListMiddlewareContext,
  ReadonlyMiddlewareContext,
  ResourcesReadMiddlewareContext,
  ResourcesListMiddlewareContext,
  ToolsCallMiddlewareContext,
  ToolsListMiddlewareContext,
} from "./middleware/mcp-middleware.js";
export {
  composeMiddleware,
  createMcpEventListenerEntry,
  createMcpMiddlewareEntry,
  matchesPattern,
} from "./middleware/mcp-middleware.js";
export type { NodeRequestHandler } from "./node-bridge.js";
export type {
  FromOpenAPIOptions,
  OpenAPIAuth,
  OpenAPIDocument,
  OpenAPIExcludeRule,
} from "./openapi/index.js";
export type {
  OAuthAuth,
  RequestClientContext,
  RequestContext,
  UserContext,
} from "./context.js";
export type {
  InferToolInput,
  InferToolName,
  InferToolOutput,
  ToolCallback,
  ToolDefinition,
  ToolRef,
  ToolResult,
  ToolViewConfig,
} from "./tools.js";
export type {
  ExternalViewManifestEntry,
  InlineViewManifestEntry,
  UiPermissions,
  ViewManifestEntry,
  ViewsManifest,
} from "./views/index.js";
export type {
  InferTemplateParams,
  ResourceCallback,
  ResourceDefinition,
  ResourceTemplateCallback,
  ResourceTemplateCompleter,
  ResourceTemplateCompletions,
  ResourceTemplateDefinition,
  TemplateVariableValue,
} from "./resources.js";
export type {
  InferPromptInput,
  PromptCallback,
  PromptDefinition,
} from "./prompts.js";
/**
 * @deprecated Prefer raw
 * [CallToolResult](https://ts.sdk.modelcontextprotocol.io/types/types.CallToolResult.html),
 * [ReadResourceResult](https://ts.sdk.modelcontextprotocol.io/types/types.ReadResourceResult.html),
 * or
 * [GetPromptResult](https://ts.sdk.modelcontextprotocol.io/types/types.GetPromptResult.html)
 * returns. These helpers remain for upgrade compatibility and map to the
 * official wire envelopes.
 */
export {
  array,
  audio,
  binary,
  css,
  error,
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
} from "./response-helpers.js";
/**
 * @deprecated Prefer raw wire result types from the package root.
 */
export type {
  ToolContentResult,
  TypedCallToolResult,
  WidgetResponseConfig,
} from "./response-helpers.js";
export type {
  ProxyConnection,
  ProxyHttpConfig,
  ProxyProgress,
  ProxyPrompt,
  ProxyRequestOptions,
  ProxyResource,
  ProxyServerConfig,
  ProxyTool,
} from "./mcp-proxy.js";
