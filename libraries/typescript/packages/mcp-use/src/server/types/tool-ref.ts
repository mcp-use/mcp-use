/**
 * Typed tool reference for zero-codegen type-safe `useCallTool`.
 *
 * `ToolRef` is returned by `server.tool()` and carries the tool's name, input,
 * and output types as phantom types. At runtime it is only `{ name: string }`;
 * the type information exists purely at compile time.
 *
 * This is the primary SDK-first V2 typing path because it needs no generated
 * files when the server and view share a TypeScript graph. Generated registries
 * remain useful for string-name ergonomics or cross-package clients, but should
 * not be required for the common inline JSX authoring flow.
 *
 * @example
 * ```tsx
 * const searchOrders = server.tool(
 *   { name: "search_orders", schema: z.object({ query: z.string() }) },
 *   async ({ query }) => object({ query, orders: [] })
 * );
 *
 * const { callToolAsync } = useCallTool(searchOrders);
 * ```
 */

export interface ToolRef<
  TName extends string = string,
  TInput = Record<string, any>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly name: TName;
  /** @internal Phantom types for compile-time type inference. */
  readonly _types: { input: TInput; output: TOutput };
}

/** @internal Used by server.tool() return value. */
export function createToolRef<
  TName extends string,
  TInput,
  TOutput extends Record<string, unknown>,
>(name: TName): ToolRef<TName, TInput, TOutput> {
  return { name } as ToolRef<TName, TInput, TOutput>;
}
