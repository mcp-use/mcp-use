/**
 * Factory for generating fully-typed hooks from a tool map
 */

import { useCallTool as useCallToolBase } from "./useCallTool.js";
import { useWidget } from "./useWidget.js";
import type {
  CallToolResponse,
  UnknownObject,
  UseWidgetResult,
} from "./widget-types.js";
import type { UseCallToolReturn } from "./useCallTool.js";

/**
 * Tool map structure: maps tool names to their input/output types
 *
 * @example
 * ```typescript
 * type MyToolMap = {
 *   "search-flights": {
 *     input: { destination: string; date?: string };
 *     output: { flights: Array<{ id: string; price: number }> };
 *   };
 *   "book-flight": {
 *     input: { flightId: string };
 *     output: { confirmation: string };
 *   };
 * };
 * ```
 */
export type ToolMap = Record<
  string,
  {
    input: UnknownObject | null;
    output?: UnknownObject;
  }
>;

/**
 * Extract tool input type from tool map
 */
export type ToolInput<
  TMap extends ToolMap,
  TName extends keyof TMap,
> = TMap[TName]["input"];

/**
 * Extract tool output type from tool map (combined with CallToolResponse)
 */
export type ToolOutput<
  TMap extends ToolMap,
  TName extends keyof TMap,
> = CallToolResponse &
  (TMap[TName]["output"] extends UnknownObject
    ? { structuredContent: TMap[TName]["output"] }
    : Record<string, never>);

/**
 * Type-safe useCallTool hook bound to a specific tool map
 */
export type TypedUseCallTool<TMap extends ToolMap> = <
  TName extends keyof TMap & string,
>(
  name: TName
) => UseCallToolReturn<ToolInput<TMap, TName>, ToolOutput<TMap, TName>>;

/**
 * Helper type to convert null to UnknownObject for useWidget compatibility
 */
type WidgetInputType<T> = T extends null ? UnknownObject : T;

/**
 * Type-safe useToolInfo hook bound to a specific tool map
 */
export type TypedUseToolInfo<TMap extends ToolMap> = <
  TName extends keyof TMap & string,
>() => UseWidgetResult<
  WidgetInputType<ToolInput<TMap, TName>>,
  ToolOutput<TMap, TName>,
  UnknownObject,
  UnknownObject,
  WidgetInputType<ToolInput<TMap, TName>>
>;

/**
 * Generate fully-typed hook helpers from a tool map.
 *
 * **NOTE**: This is an alternative to the automatic ToolRegistry approach.
 * When using `mcp-use dev`, types are auto-generated in `.mcp-use/tool-registry.d.ts`
 * and `useCallTool` is automatically typed without needing this factory.
 *
 * Use this factory for advanced use cases like:
 * - Running without `mcp-use dev` (e.g., custom build setup)
 * - Scoping types to a specific subset of tools
 * - Using different tool maps in different parts of your app
 *
 * @template TMap - The tool map defining all tools and their types
 * @returns Object with typed useCallTool and useToolInfo hooks
 *
 * @example
 * ```typescript
 * // PREFERRED: Use mcp-use dev (auto-generates types)
 * import { useCallTool } from "mcp-use/react";
 * const { callTool, data } = useCallTool("search-flights");
 * // ^ Automatically typed from your server's tool definition
 *
 * // ALTERNATIVE: Use generateHelpers for custom scenarios
 * type MyToolMap = {
 *   "search-flights": {
 *     input: { destination: string; date?: string };
 *     output: { flights: Array<{ id: string; price: number }> };
 *   };
 * };
 *
 * const { useCallTool } = generateHelpers<MyToolMap>();
 * const { callTool, data } = useCallTool("search-flights");
 * ```
 */
export function generateHelpers<TMap extends ToolMap>() {
  /**
   * Typed useCallTool hook for calling tools with full type inference
   */
  const useCallTool: TypedUseCallTool<TMap> = <
    TName extends keyof TMap & string,
  >(
    name: TName
  ) => {
    return useCallToolBase<ToolInput<TMap, TName>, ToolOutput<TMap, TName>>(
      name
    );
  };

  /**
   * Typed useToolInfo hook for accessing current tool state
   */
  const useToolInfo = <TName extends keyof TMap & string>() => {
    // Use type assertion since we know the mapping is correct
    return useWidget() as UseWidgetResult<
      WidgetInputType<ToolInput<TMap, TName>>,
      ToolOutput<TMap, TName>,
      UnknownObject,
      UnknownObject,
      WidgetInputType<ToolInput<TMap, TName>>
    >;
  };

  return {
    useCallTool,
    useToolInfo,
  };
}

/**
 * Helper type to infer a tool map from Zod schemas.
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 *
 * // Define schemas
 * const searchSchema = z.object({
 *   destination: z.string(),
 *   date: z.string().optional()
 * });
 *
 * const flightsOutputSchema = z.object({
 *   flights: z.array(z.object({
 *     id: z.string(),
 *     price: z.number()
 *   }))
 * });
 *
 * // Create tool map from schemas
 * type MyToolMap = InferToolMapFromSchemas<{
 *   "search-flights": {
 *     schema: typeof searchSchema;
 *     outputSchema: typeof flightsOutputSchema;
 *   };
 * }>;
 * ```
 */
export type InferToolMapFromSchemas<
  T extends Record<
    string,
    {
      schema?: any;
      outputSchema?: any;
    }
  >,
> = {
  [K in keyof T]: {
    input: T[K]["schema"] extends { _input: infer I }
      ? I
      : T[K]["schema"] extends { _type: infer I }
        ? I
        : null;
    output: T[K]["outputSchema"] extends { _output: infer O }
      ? O
      : T[K]["outputSchema"] extends { _type: infer O }
        ? O
        : undefined;
  };
};
