import type { AuthInfo } from "../oauth/utils.js";

/**
 * Simplified tool info returned by onListTools middleware.
 * Mirrors the Tool type from the MCP SDK.
 */
export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

/**
 * Simplified prompt info returned by onListPrompts middleware.
 */
export interface PromptInfo {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/**
 * Simplified resource info returned by onListResources middleware.
 */
export interface ResourceInfo {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

/**
 * Context passed to middleware hooks.
 * Provides information about the current request and session.
 */
export interface MiddlewareContext {
  /** OAuth authentication info when configured */
  auth?: AuthInfo;
  /** HTTP request context (Hono Context) */
  request?: unknown;
  /** Current session ID */
  sessionId?: string;
  /** Server metadata */
  server: { name: string; version: string };
}

/**
 * Hook for intercepting tools/list requests.
 * Called with the middleware context and a `callNext` function that invokes
 * the next middleware or the base handler.
 */
export type OnListToolsHook = (
  ctx: MiddlewareContext,
  callNext: () => Promise<ToolInfo[]>
) => Promise<ToolInfo[]>;

/**
 * Hook for intercepting tools/call requests.
 * Called with the middleware context, call parameters, and a `callNext` function.
 */
export type OnCallToolHook = (
  ctx: MiddlewareContext,
  params: { name: string; arguments?: Record<string, unknown> },
  callNext: () => Promise<CallToolResultLike>
) => Promise<CallToolResultLike>;

/**
 * Hook for intercepting prompts/list requests.
 */
export type OnListPromptsHook = (
  ctx: MiddlewareContext,
  callNext: () => Promise<PromptInfo[]>
) => Promise<PromptInfo[]>;

/**
 * Hook for intercepting resources/list requests.
 */
export type OnListResourcesHook = (
  ctx: MiddlewareContext,
  callNext: () => Promise<ResourceInfo[]>
) => Promise<ResourceInfo[]>;

/**
 * A CallToolResult-like object. Kept loose to avoid coupling to SDK internals.
 */
export interface CallToolResultLike {
  content?: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Middleware definition for intercepting MCP protocol operations.
 *
 * Register via `server.use(middleware)`. Middlewares execute in registration order,
 * each wrapping the next in an onion model. The innermost layer is the SDK's
 * default handler.
 *
 * @example
 * ```typescript
 * server.use({
 *   name: "role-filter",
 *   onListTools: async (ctx, callNext) => {
 *     const tools = await callNext();
 *     return tools.filter(t => !t.name.startsWith("admin-"));
 *   },
 * });
 * ```
 */
export interface Middleware {
  /** Optional name for debugging/logging */
  name?: string;
  /** Intercept tools/list to filter or modify the returned tool list */
  onListTools?: OnListToolsHook;
  /** Intercept tools/call to block, modify, or wrap tool execution */
  onCallTool?: OnCallToolHook;
  /** Intercept prompts/list to filter or modify the returned prompt list */
  onListPrompts?: OnListPromptsHook;
  /** Intercept resources/list to filter or modify the returned resource list */
  onListResources?: OnListResourcesHook;
}
