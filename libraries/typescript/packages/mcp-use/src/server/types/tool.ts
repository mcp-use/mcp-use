import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { ToolContext } from "./tool-context.js";
import type { McpContext } from "./context.js";
import type { z } from "zod";
import type {
  ToolContentResult,
  TypedCallToolResult,
} from "../utils/response-helpers.js";
import type { AuthRequirement } from "../oauth/types.js";

// Re-export MCP SDK types for convenience
export type { ToolAnnotations };

/**
 * Enhanced Tool Context that combines ToolContext methods with Hono request context.
 *
 * This unified context provides:
 * - `sample()` - LLM sampling method from ToolContext
 * - `reportProgress()` - Progress reporting from ToolContext
 * - `auth` - Authentication info (when OAuth is configured)
 * - `req` - Hono request object
 * - All other Hono Context properties and methods
 *
 * @template HasOAuth - Whether OAuth is configured (affects auth availability)
 */
export type EnhancedToolContext<HasOAuth extends boolean = false> =
  ToolContext & McpContext<HasOAuth>;

/**
 * Callback function interface for tool execution.
 *
 * Uses method signature syntax to enable bivariant parameter checking,
 * which allows more flexible destructuring patterns for optional fields.
 *
 * Accepts input parameters and an optional enhanced context object that provides:
 * - LLM sampling via `ctx.sample()`
 * - Progress reporting via `ctx.reportProgress()`
 * - Authentication info via `ctx.auth` (when OAuth is configured)
 * - HTTP request via `ctx.req`
 * - All Hono Context properties and methods
 *
 * @template TInput - Input parameters type
 * @template TOutput - Output type (constrains the structuredContent property when outputSchema is defined)
 * @template HasOAuth - Whether OAuth is configured (affects ctx.auth availability)
 *
 * @example
 * ```typescript
 * // Simple tool without context
 * cb: async ({ name }) => ({
 *   content: [{ type: 'text', text: `Hello, ${name}!` }]
 * })
 *
 * // Tool with sampling
 * cb: async ({ text }, ctx) => {
 *   const result = await ctx.sample({
 *     messages: [{ role: 'user', content: { type: 'text', text } }]
 *   });
 *   return { content: result.content };
 * }
 *
 * // Tool with authentication
 * cb: async ({ userId }, ctx) => {
 *   return { content: [{ type: 'text', text: `User: ${ctx.auth.user.email}` }] };
 * }
 * ```
 */
/**
 * Helper interface that uses method signature syntax to enable bivariant parameter checking.
 * This allows more flexible callback assignments where users can destructure optional fields
 * without explicitly marking them as optional in their function signature.
 *
 * @internal
 */
interface ToolCallbackBivariant<
  TInput,
  TOutput extends Record<string, unknown>,
  HasOAuth extends boolean,
> {
  // Method signature enables bivariant checking for TInput parameter.
  // Return type: a structured result whose structuredContent must match the
  // tool's outputSchema (TOutput), OR a content-only result (text(), markdown(),
  // image(), ...). Content-only helpers carry no structuredContent, so they are
  // always allowed; object()/widget() carry structuredContent and are therefore
  // checked against outputSchema at compile time.
  bivarianceHack(
    params: TInput,
    ctx: EnhancedToolContext<HasOAuth>
  ): Promise<TypedCallToolResult<TOutput> | ToolContentResult>;
}

/**
 * Callback function type for tool execution.
 *
 * Uses bivariant parameter checking via method signature extraction,
 * which allows more flexible destructuring patterns for optional fields.
 *
 * Accepts input parameters and an enhanced context object that provides:
 * - LLM sampling via `ctx.sample()`
 * - Progress reporting via `ctx.reportProgress()`
 * - Elicitation via `ctx.elicit()`
 * - Authentication info via `ctx.auth` (when OAuth is configured)
 * - HTTP request via `ctx.req`
 * - All Hono Context properties and methods
 *
 * @template TInput - Input parameters type
 * @template TOutput - Output type (constrains the structuredContent property when outputSchema is defined)
 * @template HasOAuth - Whether OAuth is configured (affects ctx.auth availability)
 *
 * @example
 * ```typescript
 * // Simple tool without context
 * async ({ name }) => ({
 *   content: [{ type: 'text', text: `Hello, ${name}!` }]
 * })
 *
 * // Tool with sampling and context
 * async ({ text }, ctx) => {
 *   const result = await ctx.sample({
 *     messages: [{ role: 'user', content: { type: 'text', text } }]
 *   });
 *   return { content: result.content };
 * }
 *
 * // Tool with authentication
 * async ({ userId }, ctx) => {
 *   return { content: [{ type: 'text', text: `User: ${ctx.auth.user.email}` }] };
 * }
 * ```
 */
export type ToolCallback<
  TInput = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
  HasOAuth extends boolean = false,
> = ToolCallbackBivariant<TInput, TOutput, HasOAuth>["bivarianceHack"];

/**
 * Generic callback with full context support for better type inference.
 * This variant always requires the context parameter.
 */
export type ToolCallbackWithContext<
  TInput = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
  HasOAuth extends boolean = false,
> = (
  params: TInput,
  ctx: EnhancedToolContext<HasOAuth>
) => Promise<TypedCallToolResult<TOutput> | ToolContentResult>;

/**
 * Extract input type from a tool definition's schema.
 * Uses z.infer which preserves Zod's optional/default handling.
 *
 * For .optional() fields, the type will be T | undefined
 * For .default() fields, the type will be T (since Zod guarantees a value)
 */
export type InferToolInput<T> = T extends { schema: infer S }
  ? S extends z.ZodTypeAny
    ? z.infer<S>
    : Record<string, unknown>
  : Record<string, unknown>;

/**
 * Extract output type from a tool definition's output schema
 */
export type InferToolOutput<T> = T extends { outputSchema: infer S }
  ? S extends z.ZodTypeAny
    ? z.infer<S>
    : Record<string, unknown>
  : Record<string, unknown>;

export interface ToolDefinition<
  _TInput = Record<string, unknown>,
  _TOutput extends Record<string, unknown> = Record<string, unknown>,
  _HasOAuth extends boolean = false,
> {
  /**
   * Unique identifier for the tool .
   * Must match the name passed to useCallTool("name") in widget components.
   *
   * @example "search-products"
   * @example "get-weather"
   */
  name: string;
  /**
   * Human-readable title displayed in UI (clients, inspector).
   * If omitted, `name` is used.
   *
   * @example "Search Products"
   */
  title?: string;
  /**
   * LLM-facing description of what the tool does.
   * Helps the model decide when to invoke this tool.
   *
   * @example "Search products by query and display results in a visual widget"
   */
  description?: string;
  /**
   * Zod schema for input validation.
   *
   * This is the mcp-use public authoring API. Internally, the SDK bridge converts
   * it to the official SDK `inputSchema` shape, so application code should not
   * import SDK schema helpers just to define normal tools. Use `.describe()` on
   * each field for LLM-facing hints.
   *
   * @example z.object({ query: z.string().describe("Search term"), limit: z.number().optional().describe("Max results") })
   */
  schema?: z.ZodTypeAny;
  /**
   * Zod schema for structured output.
   *
   * Enables `ToolRef` / `useCallTool(toolRef)` inference in the zero-codegen path.
   * Generated registries are a secondary path for string-name or cross-package
   * clients and should be produced explicitly under `.mcp-use/generated/`.
   *
   * @example z.object({ fruit: z.string(), color: z.string(), facts: z.array(z.string()) })
   */
  outputSchema?: z.ZodTypeAny;
  /** Tool annotations */
  annotations?: ToolAnnotations;
  /** Optional authorization requirement enforced on tools/list and tools/call */
  auth?: AuthRequirement;
  /** Metadata for the tool */
  _meta?: Record<string, unknown>;
  /**
   * Configuration for tools that return a view via the legacy `widget()` helper.
   *
   * Direct inline JSX returns are the first-class V2 path. Keep this option for
   * explicit file-based views, migration, or advanced cases where the framework
   * cannot infer the view from the returned component.
   *
   * @example
   * ```typescript
   * server.tool({
   *   name: "get-weather",
   *   schema: z.object({ city: z.string() }),
   *   widget: {
   *     name: "weather-display",  // Must match a widget in resources/
   *     invoking: "Fetching weather data...",
   *     invoked: "Weather loaded"
   *   }
   * }, async ({ city }) => {
   *   const data = await fetchWeather(city);
   *   return widget({
   *     props: { city, ...data }
   *   });
   * });
   * ```
   */
  widget?: ToolWidgetConfig;
}

/**
 * Configuration for a tool that returns a widget.
 * Set at registration time; configures metadata for widget rendering in Inspector and ChatGPT.
 */
export interface ToolWidgetConfig {
  /**
   * Widget name; must match a file in resources/ (e.g., resources/weather-display.tsx).
   *
   * @example "weather-display"
   * @example "product-search-result"
   */
  name: string;
  /**
   * Status text shown while the tool is running.
   * Defaults to "Loading {name}..." if omitted.
   *
   * @example "Fetching weather data..."
   * @example "Searching fruits..."
   */
  invoking?: string;
  /**
   * Status text shown after the tool completes.
   * Defaults to "{name} ready" if omitted.
   *
   * @example "Weather loaded"
   * @example "Fruits loaded"
   */
  invoked?: string;
  /**
   * Whether the widget can initiate tool calls (e.g., useCallTool).
   * Defaults to true.
   */
  widgetAccessible?: boolean;
  /**
   * Whether this tool result can produce a widget.
   * Defaults to true.
   */
  resultCanProduceWidget?: boolean;
}
