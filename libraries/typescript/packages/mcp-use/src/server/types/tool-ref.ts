/**
 * Typed tool reference for zero-codegen type-safe useCallTool.
 *
 * `ToolRef` is returned by `server.tool()` and carries the tool's name,
 * input, and output types as phantom types. At runtime it's just
 * `{ name: string }` — the type information exists only at compile time.
 *
 * @example
 * ```ts
 * // Server
 * export const analyzeText = server.tool({
 *   name: "analyze-text",
 *   schema: z.object({ text: z.string() }),
 * }, handler);
 * // analyzeText: ToolRef<"analyze-text", { text: string }, Record<string, unknown>>
 *
 * // Widget
 * import { analyzeText } from "../server";
 * const { callTool } = useCallTool(analyzeText);
 * callTool({ text: "hello" }); // fully typed
 * ```
 */

/**
 * A lightweight typed reference to a registered tool.
 *
 * Carries input/output types as phantom types for compile-time inference.
 * At runtime, only `name` exists on the object.
 */
export interface ToolRef<
  TName extends string = string,
  TInput = Record<string, any>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Tool name (the only runtime property). */
  readonly name: TName;
  /**
   * Phantom types for compile-time type inference.
   * NOT present at runtime — used by `useCallTool(ref)` overload.
   * @internal
   */
  readonly _types: { input: TInput; output: TOutput };
}

/**
 * Create a ToolRef value at runtime. The `_types` property is a
 * phantom — TypeScript carries it at the type level only.
 *
 * @internal Used by server.tool() return value.
 */
export function createToolRef<
  TName extends string,
  TInput,
  TOutput extends Record<string, unknown>,
>(name: TName): ToolRef<TName, TInput, TOutput> {
  return { name } as ToolRef<TName, TInput, TOutput>;
}
