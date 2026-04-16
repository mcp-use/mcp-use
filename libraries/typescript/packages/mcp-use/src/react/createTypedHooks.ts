/**
 * tRPC-style typed hook factory for zero-codegen type inference.
 *
 * Creates typed `useCallTool` and `useToolInfo` hooks by inferring
 * types from the server's tool definitions via `import type`.
 *
 * @example
 * ```tsx
 * // server.ts
 * export const tools = server.defineTools({
 *   "analyze-text": {
 *     schema: z.object({ text: z.string() }),
 *     handler: async ({ text }) => { ... },
 *   },
 * });
 *
 * // widget.tsx
 * import type { tools } from "../server";
 * import { createTypedHooks } from "mcp-use/react";
 *
 * const { useCallTool } = createTypedHooks<typeof tools>();
 * const { callTool } = useCallTool("analyze-text");
 * callTool({ text: "hello" }); // fully typed!
 * ```
 */

import { useCallTool as useCallToolBase } from "./useCallTool.js";
import type {
  CallToolResponse,
  UnknownObject,
} from "./widget-types.js";
import type { UseCallToolReturn } from "./useCallTool.js";

/**
 * Infer input type from a tool definition's schema.
 * Handles both Zod v3 (`_input`) and Zod v4 (`_type`) inference.
 */
type InferSchemaType<S> = S extends { _input: infer I }
  ? I
  : S extends { _type: infer I }
    ? I
    : null;

/**
 * Infer output type from a tool definition's outputSchema.
 */
type InferOutputSchemaType<S> = S extends { _output: infer O }
  ? O
  : S extends { _type: infer O }
    ? O
    : undefined;

/**
 * Extract input type from a tool definition map entry.
 */
type ExtractInput<T> = T extends { schema: infer S }
  ? InferSchemaType<S>
  : null;

/**
 * Extract output type from a tool definition map entry.
 */
type ExtractOutput<T> = T extends { outputSchema: infer S }
  ? InferOutputSchemaType<S>
  : undefined;

/**
 * Resolve the response type for a tool (with structuredContent if output schema present).
 */
type ResolveResponse<T> = ExtractOutput<T> extends UnknownObject
  ? CallToolResponse & { structuredContent: ExtractOutput<T> }
  : CallToolResponse;

/**
 * Create typed hooks from a tool definition map.
 *
 * Uses `import type` from the server so zero runtime code reaches
 * the client bundle. All type inference happens at compile time.
 *
 * @template T - The `typeof tools` from `server.defineTools()`
 * @returns Object with typed `useCallTool` hook
 *
 * @example
 * ```tsx
 * import type { tools } from "../server";
 * const { useCallTool } = createTypedHooks<typeof tools>();
 * const { callTool, data } = useCallTool("analyze-text");
 * ```
 */
export function createTypedHooks<
  T extends Record<string, { schema?: any; outputSchema?: any }>,
>() {
  return {
    useCallTool: <TName extends keyof T & string>(
      name: TName
    ): UseCallToolReturn<ExtractInput<T[TName]>, ResolveResponse<T[TName]>> => {
      return useCallToolBase(name) as any;
    },
  };
}
