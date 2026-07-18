/**
 * `mcp-use` — MCP server framework on the official v2 SDK (fetch-native).
 *
 * Greenfield rebuild of the mcp-use server package against the stateless
 * 2026-07-28 MCP protocol. See specs/SPEC.md for the phase plan and API contract.
 */

export { MCPServer } from "./server.js";
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
  routeFetch,
  toFrameworkHandler,
} from "./fetch-app.js";
export type {
  FetchHandler,
  FetchMiddleware,
  FrameworkHandler,
  FrameworkRequestLike,
  RequestBag,
} from "./fetch-app.js";
export { registerViews } from "./views/index.js";
export { requestLogger } from "./logging.js";
export type { LoggingOptions, LogLevel } from "./logging.js";
export type {
  LandingPageOptions,
  LandingPagePrompt,
  LandingPageResource,
  LandingPageTool,
} from "./landing.js";

/**
 * Wire result shapes (re-exported from the SDK): callbacks return these raw
 * shapes directly — tools return {@link CallToolResult}, resources
 * {@link ReadResourceResult}, prompts {@link GetPromptResult}. There is no
 * framework-specific result layer.
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

export type { InspectorOptions, ServerConfig, CorsOptions } from "./config.js";
export type {
  MiddlewareContext,
  McpCompleteEventListenerFn,
  McpEventListenerFn,
  McpMiddlewareFn,
  McpMiddlewareFnFor,
  McpMiddlewarePatternMap,
  PromptsGetMiddlewareContext,
  ResourcesReadMiddlewareContext,
  ToolsCallMiddlewareContext,
} from "./middleware/mcp-middleware.js";
export {
  composeMiddleware,
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
  Elicit,
  ElicitationResult,
  OAuthAuth,
  RequestClientContext,
  RequestContext,
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
