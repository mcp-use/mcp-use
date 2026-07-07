/**
 * `@mcp-use/server` — MCP server framework on the official v2 SDK and Hono.
 *
 * Greenfield rebuild of the mcp-use server package against the stateless
 * 2026-07-28 MCP protocol. See specs/SPEC.md for the phase plan and API contract.
 */

export { MCPServer } from "./server.js";
export { mountMcp } from "./mount-mcp.js";
export type { MountMcpOptions } from "./mount-mcp.js";
export { registerViews } from "./views/index.js";
export { requestLogger } from "./logging.js";
export type { LoggingOptions, LogLevel } from "./logging.js";

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
  PromptMessage,
  ReadResourceResult,
} from "@modelcontextprotocol/server";

export { completable } from "./completable.js";
export type { CompletionCallback, CompletionContext } from "./completable.js";

/**
 * Schema contracts accepted by `schema`/`outputSchema` fields (re-exported
 * from the SDK): `StandardSchemaWithJSON` requires validation plus JSON
 * Schema conversion; `completable()` needs only `StandardSchemaV1`.
 * Implemented by zod v4, ArkType, Valibot, …
 */
export type {
  StandardSchemaV1,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";

export type { InspectorOptions, ServerConfig } from "./config.js";
export type { RequestClientContext, RequestContext } from "./context.js";
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
export type { UiPermissions, ViewManifestEntry, ViewsManifest } from "./views/index.js";
export type {
  InferTemplateParams,
  ResourceCallback,
  ResourceDefinition,
  ResourceTemplateCallback,
  ResourceTemplateDefinition,
  TemplateVariableValue,
} from "./resources.js";
export type {
  InferPromptInput,
  PromptCallback,
  PromptDefinition,
} from "./prompts.js";
